import { addDebtPayment, db, saveMovement, type InboxItem, type Rule } from '../data/db'
import { syncDebts } from '../data/debtSync'
import { parseAlert, type ParsedAlert } from './parsers'
import { merchantKey, suggestCategory } from './rules'

export interface IncomingRaw {
  id: string
  source: InboxItem['source']
  text: string
  receivedAt?: number
}

// Qué registro preferimos conservar cuando el mismo pago llega varias veces:
// la alerta del banco > Apple Pay o SMS > recibo de PSE o del comercio.
function rank(i: Pick<InboxItem, 'role' | 'source'>) {
  if (i.role === 'comprobante') return 0
  return i.source === 'gmail' ? 2 : 1
}

function dayDiff(a: string, b: string) {
  return Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000
}

// Dos registros son "gemelos" si es razonable que sean el mismo pago:
// mismo valor y tipo, a máximo un día, y no son dos compras reales del mismo
// banco (esas sí pueden repetirse, como dos Uber del mismo valor).
function isTwin(a: InboxItem, b: InboxItem) {
  if (a.amount !== b.amount || a.kind !== b.kind || dayDiff(a.date, b.date) > 1) return false
  const bothBankAlerts = a.role === 'movimiento' && b.role === 'movimiento' && a.source === b.source
  return !bothBankAlerts
}

async function toItem(id: string, source: InboxItem['source'], p: ParsedAlert, receivedAt: number): Promise<InboxItem> {
  const rules = await db.rules.toArray()
  const s = (await debtFor(p.merchant, p.kind)) ? { category: p.kind === 'gasto' ? 'Deudas' : 'Otros', subcategory: 'Otros' } : suggestCategory(p.merchant, p.kind, rules)
  return {
    id, source, bank: p.bank, role: p.role, kind: p.kind,
    date: p.date, time: p.time, amount: p.amount, merchant: p.merchant, account: p.account,
    category: s.category, subcategory: s.subcategory,
    status: 'pendiente', receivedAt,
  }
}

async function addWithDedupe(item: InboxItem) {
  const nearby = await db.inbox.where('date').between(shiftDate(item.date, -1), shiftDate(item.date, 1), true, true).toArray()
  // Un registro solo se empareja una vez por fuente: si ya tiene un repetido
  // de esta misma fuente (por ejemplo, una línea del extracto), un segundo
  // pago igual ese día es otro pago, no el mismo.
  const alreadyPaired = (x: InboxItem) => nearby.some((d) => d.duplicateOf === x.id && d.source === item.source)
  const twin = nearby
    .filter((x) => (x.status === 'pendiente' || x.status === 'aceptado') && isTwin(x, item) && !alreadyPaired(x))
    .sort((a, b) => rank(b) - rank(a))[0]

  if (twin && (twin.status === 'aceptado' || rank(twin) >= rank(item))) {
    item.status = 'duplicado'
    item.duplicateOf = twin.id
  } else if (twin) {
    await db.inbox.update(twin.id, { status: 'duplicado', duplicateOf: item.id })
  }
  await db.inbox.add(item)
}

function shiftDate(date: string, days: number) {
  const d = new Date(`${date}T12:00:00`)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

// Devuelve cuántos movimientos nuevos quedaron por revisar.
export async function ingest(raws: IncomingRaw[]) {
  let added = 0
  for (const r of raws) {
    if (await db.inbox.get(r.id)) continue
    const parsed = parseAlert(r.text)
    if (!parsed) continue
    const item = await toItem(r.id, r.source, parsed, r.receivedAt ?? Date.now())
    await addWithDedupe(item)
    if (item.status === 'pendiente') added++
  }
  return added
}

// Movimientos de un extracto. Los que son entre tus cuentas quedan aparte.
export async function ingestStatement(items: { id: string; parsed: ParsedAlert; own: boolean }[]) {
  let added = 0
  let own = 0
  let repeated = 0
  for (const it of items) {
    if (await db.inbox.get(it.id)) continue
    const item = await toItem(it.id, 'extracto', it.parsed, Date.now())
    if (it.own) {
      item.status = 'propia'
      await db.inbox.add(item)
      own++
      // La otra punta (por ejemplo, "Transferiste … a Nequi" de Bancolombia)
      // también es entre tus cuentas.
      const near = await db.inbox.where('date').between(shiftDate(item.date, -1), shiftDate(item.date, 1), true, true).toArray()
      for (const x of near) {
        if (x.status === 'pendiente' && x.source !== 'extracto' && x.amount === item.amount && x.kind !== item.kind) {
          await db.inbox.update(x.id, { status: 'propia' })
        }
      }
      continue
    }
    await addWithDedupe(item)
    if (item.status === 'pendiente') added++
    else repeated++
  }
  return { added, own, repeated }
}

export async function ingestParsed(id: string, source: InboxItem['source'], parsed: ParsedAlert) {
  if (await db.inbox.get(id)) return false
  const item = await toItem(id, source, parsed, Date.now())
  await addWithDedupe(item)
  return item.status === 'pendiente'
}

export async function accept(item: InboxItem, category = item.category, subcategory = item.subcategory) {
  const movementId = await saveMovement({
    date: item.date,
    kind: item.kind,
    category,
    subcategory,
    description: item.merchant,
    amount: item.amount,
    recurrence: 'ocasional',
    source: item.source,
    createdAt: Date.now(),
  })
  const key = merchantKey(item.merchant)
  const rule: Rule = { id: `${item.kind}|${key}`, key, kind: item.kind, category, subcategory }
  await db.transaction('rw', db.inbox, db.rules, async () => {
    await db.inbox.update(item.id, { status: 'aceptado', category, subcategory, movementId })
    // Aprende: la próxima vez este comercio llega con esta categoría.
    await db.rules.put(rule)
    const pending = await db.inbox.where('status').equals('pendiente').toArray()
    for (const p of pending) {
      if (p.kind === item.kind && merchantKey(p.merchant) === key) await db.inbox.update(p.id, { category, subcategory })
    }
  })
  await linkToDebt(item)
}

// La deuda a la que corresponde un movimiento: una transferencia a Juan Camilo
// es un pago de la deuda que tienes con él.
async function debtFor(merchant: string, kind: InboxItem['kind']) {
  const upper = merchant.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  return (await db.debts.toArray()).find(
    (d) =>
      ((d.direction === 'debo' && kind === 'gasto') || (d.direction === 'me-deben' && kind === 'ingreso')) &&
      d.keywords.some((k) => k && upper.includes(k.toUpperCase())),
  )
}

async function linkToDebt(item: InboxItem) {
  const debt = await debtFor(item.merchant, item.kind)
  if (!debt) return
  const id = `alerta-${item.id}`.replace(/[^A-Za-z0-9_\-.~:@+]/g, '-')
  await addDebtPayment(debt.id, { id, date: item.date, amount: item.amount, note: `Desde ${item.bank}`, source: 'alerta' })
  void syncDebts()
}

export async function acceptAll() {
  const pending = await db.inbox.where('status').equals('pendiente').toArray()
  for (const p of pending) await accept(p)
  return pending.length
}

export function ignore(item: InboxItem) {
  return db.inbox.update(item.id, { status: 'ignorado' })
}

export function restore(item: InboxItem) {
  return db.inbox.update(item.id, { status: 'pendiente', duplicateOf: undefined })
}

export function updateSuggestion(item: InboxItem, category: string, subcategory: string) {
  return db.inbox.update(item.id, { category, subcategory })
}
