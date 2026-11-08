import Dexie, { type EntityTable } from 'dexie'
import type { Kind } from './categories'
import type { DebtEvent, DebtTerms } from '../lib/debt'
import type { CardSummary } from '../import/statements'

// Todo vive en IndexedDB del dispositivo. Las funciones de este archivo son la
// única puerta a los datos. Los movimientos, la bandeja, el presupuesto, las
// reglas, las tarjetas, los cobros y los saldos se sincronizan entre tus dispositivos (ver sync.ts);
// las deudas van por su lado (debtSync.ts).

export type Recurrence = 'fijo' | 'ocasional'
export type Source = 'manual' | 'gmail' | 'applepay' | 'sms' | 'extracto'

// Campos para sincronizar: cuándo cambió el registro y si se borró.
// Borrar deja una "lápida" (deleted) para que el borrado llegue al otro dispositivo.
export interface Synced {
  updatedAt?: number
  deleted?: boolean
}

export interface Movement extends Synced {
  id?: string
  date: string // YYYY-MM-DD
  kind: Kind
  category: string
  subcategory: string
  description: string
  amount: number // pesos, siempre positivo
  recurrence: Recurrence
  source: Source
  createdAt: number
}

export interface Budget extends Synced {
  id: string // `${month}|${category}`
  month: string // YYYY-MM
  category: string
  amount: number
}

// 'propia': movimiento entre tus propias cuentas (no es gasto ni ingreso).
export type InboxStatus = 'pendiente' | 'aceptado' | 'ignorado' | 'duplicado' | 'propia'

// Movimiento detectado automáticamente (correo, Apple Pay, alerta pegada),
// esperando a que lo revises antes de entrar a tus cuentas.
export interface InboxItem extends Synced {
  id: string // id del correo, o uno generado
  source: Exclude<Source, 'manual'>
  bank: string
  role: 'movimiento' | 'comprobante'
  kind: Kind
  date: string
  time?: string
  amount: number
  merchant: string
  account?: string
  category: string
  subcategory: string
  status: InboxStatus
  duplicateOf?: string
  movementId?: string
  receivedAt: number
}

export interface Rule extends Synced {
  id: string // `${kind}|${key}`
  key: string
  kind: Kind
  category: string
  subcategory: string
}

// manualPayment: el "Ya pagué" que marcas tú cuando el pago no llega por correo.
export type CardRecord = CardSummary & Synced & { manualPayment?: { date: string; amount: number } }

export interface Setting {
  key: string
  value: string
}

// Cuenta de cobro: trabajo ya hecho que todavía no te pagan (no es un préstamo).
// paid: cuándo y cuánto te pagaron (puede ser menos por la retención en la fuente).
// rejected: pagos que la app te propuso y dijiste que no eran de este cobro.
export interface Receivable extends Synced {
  id: string
  client: string
  concept: string
  amount: number
  sentDate: string // cuándo enviaste la cuenta de cobro
  dueDate?: string // cuándo quedaron de pagarte
  keywords: string[] // cómo aparece el cliente en las alertas del banco
  paid?: { date: string; amount: number; inboxId?: string }
  rejected?: string[]
  createdAt: number
}

// Saldo de una cuenta en una fecha, anotado por ti. Se guarda el historial para
// comparar cada anotación con la anterior (ver lib/balances.ts).
export interface AccountBalance extends Synced {
  id: string // `${date}|${account}`
  date: string
  account: string
  amount: number
}

// Extracto que llegó a tu correo, esperando a que lo leas en Revisar (con la
// contraseña del PDF, que escribes tú). No se sincroniza: cada dispositivo
// lo descarga, y leerlo dos veces no repite movimientos.
export interface MailStatement {
  id: string // id del correo
  date: string
  from: string
  subject: string
  files: { name: string; mime: string; data: string }[] // archivos en base64
  status: 'pendiente' | 'leido' | 'descartado'
}

export interface Debt extends DebtTerms {
  id: string
  name: string // con quién es la deuda
  direction: 'debo' | 'me-deben'
  keywords: string[] // nombres con que aparece en las alertas, para reconocer pagos
  pendingUpload?: boolean // datos de la deuda aún no subidos a la hoja
}

const db = new Dexie('finanzas') as Dexie & {
  movs: EntityTable<Movement, 'id'>
  budgets: EntityTable<Budget, 'id'>
  inbox: EntityTable<InboxItem, 'id'>
  rules: EntityTable<Rule, 'id'>
  settings: EntityTable<Setting, 'key'>
  debts: EntityTable<Debt, 'id'>
  cards: EntityTable<CardRecord, 'id'>
  cobros: EntityTable<Receivable, 'id'>
  saldos: EntityTable<AccountBalance, 'id'>
  extractos: EntityTable<MailStatement, 'id'>
}

db.version(1).stores({
  movements: '++id, date, kind, category',
  budgets: 'id, month',
})

db.version(2).stores({
  inbox: 'id, status, date',
  rules: 'id',
  settings: 'key',
})

db.version(3).stores({
  debts: 'id',
})

// Resumen de cada tarjeta de crédito, tomado del último extracto cargado.
db.version(4).stores({
  cards: 'id',
})

export function newId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

// Para sincronizar entre dispositivos: los movimientos pasan de números
// (1, 2, 3…, que chocarían entre dispositivos) a ids únicos, y todo lleva la
// fecha del último cambio.
db.version(5)
  .stores({
    movs: 'id, date, kind, category, updatedAt',
    budgets: 'id, month, updatedAt',
    inbox: 'id, status, date, updatedAt',
    rules: 'id, updatedAt',
    cards: 'id, updatedAt',
  })
  .upgrade(async (tx) => {
    const now = Date.now()
    const newIds = new Map<number, string>()
    const old: (Movement & { id: number })[] = await tx.table('movements').toArray()
    await tx.table('movs').bulkAdd(
      old.map((m) => {
        const id = newId()
        newIds.set(m.id, id)
        return { ...m, id, updatedAt: m.createdAt || now }
      }),
    )
    await tx.table('inbox').toCollection().modify((i: InboxItem & { movementId?: unknown }) => {
      i.updatedAt = i.receivedAt || now
      if (typeof i.movementId === 'number') i.movementId = newIds.get(i.movementId)
    })
    for (const t of ['budgets', 'rules', 'cards']) {
      await tx.table(t).toCollection().modify((r: Synced) => {
        r.updatedAt = now
      })
    }
  })

db.version(6).stores({ movements: null })

// Cuentas de cobro. Se vuelve a pedir todo a la hoja una vez, por si ya
// llegaron cobros desde otro dispositivo antes de que este los conociera.
db.version(7)
  .stores({ cobros: 'id, updatedAt' })
  .upgrade((tx) => tx.table('settings').put({ key: 'sync.since', value: '0' }))

// Saldos reales de tus cuentas. Igual que con los cobros, se vuelve a pedir todo a la hoja.
db.version(8)
  .stores({ saldos: 'id, date, updatedAt' })
  .upgrade((tx) => tx.table('settings').put({ key: 'sync.since', value: '0' }))

db.version(9).stores({ extractos: 'id, status' })

// Toda escritura marca la fecha del cambio, salvo cuando se está aplicando
// lo que llega del otro dispositivo (que ya trae su propia fecha).
export const SYNCED_TABLES = ['movs', 'budgets', 'inbox', 'rules', 'cards', 'cobros', 'saldos'] as const
export type SyncedTable = (typeof SYNCED_TABLES)[number]
let applyingRemote = false
const changeListeners = new Set<() => void>()

export function onLocalChange(fn: () => void) {
  changeListeners.add(fn)
  return () => {
    changeListeners.delete(fn)
  }
}

function notify() {
  if (!applyingRemote) setTimeout(() => changeListeners.forEach((f) => f()), 0)
}

for (const t of SYNCED_TABLES) {
  const table = db.table(t)
  table.hook('creating', (_key, obj: Synced) => {
    if (!applyingRemote || obj.updatedAt === undefined) obj.updatedAt = Date.now()
    notify()
  })
  table.hook('updating', (mods: Partial<Synced>) => {
    notify()
    return applyingRemote && 'updatedAt' in mods ? undefined : { updatedAt: Date.now() }
  })
}

export async function asRemote<T>(fn: () => Promise<T>) {
  applyingRemote = true
  try {
    return await fn()
  } finally {
    applyingRemote = false
  }
}

const alive = <T extends Synced>(r: T) => !r.deleted

export async function saveCardSummary(c: CardSummary) {
  const prev = await db.cards.get(c.id)
  // Un extracto viejo no reemplaza uno más reciente.
  if (prev && !prev.deleted && prev.cutDate > c.cutDate) return false
  await db.cards.put({ ...c, deleted: false })
  return true
}

export function markCardPaid(id: string, payment: { date: string; amount: number } | undefined) {
  return db.cards.update(id, { manualPayment: payment })
}

export async function activeCards() {
  return (await db.cards.toArray()).filter(alive)
}

export async function activeReceivables() {
  return (await db.cobros.toArray()).filter(alive)
}

export function saveReceivable(r: Omit<Receivable, 'id' | 'createdAt'> & { id?: string; createdAt?: number }) {
  return db.cobros.put({ ...r, id: r.id ?? newId(), createdAt: r.createdAt ?? Date.now(), deleted: false })
}

export function markReceivablePaid(id: string, paid: Receivable['paid']) {
  return db.cobros.update(id, { paid })
}

export async function rejectReceivablePayment(id: string, inboxId: string) {
  const r = await db.cobros.get(id)
  if (r) await db.cobros.update(id, { rejected: [...(r.rejected ?? []), inboxId] })
}

export function deleteReceivable(id: string) {
  return db.cobros.update(id, { deleted: true })
}

export async function activeBalances() {
  return (await db.saldos.toArray()).filter(alive)
}

export function saveBalances(date: string, rows: { account: string; amount: number }[]) {
  return db.saldos.bulkPut(rows.map((r) => ({ ...r, id: `${date}|${r.account}`, date, deleted: false })))
}

export async function getSetting(key: string) {
  return (await db.settings.get(key))?.value ?? ''
}

export function setSetting(key: string, value: string) {
  return db.settings.put({ key, value })
}

export { db }

export function monthRange(month: string): [string, string] {
  return [`${month}-01`, `${month}-31`]
}

export async function movementsInMonth(month: string) {
  const [from, to] = monthRange(month)
  return (await db.movs.where('date').between(from, to, true, true).toArray()).filter(alive)
}

export async function movementsInYear(year: string) {
  return (await db.movs.where('date').between(`${year}-01-01`, `${year}-12-31`, true, true).toArray()).filter(alive)
}

export async function movementsSince(date: string) {
  return (await db.movs.where('date').aboveOrEqual(date).toArray()).filter(alive)
}

export async function saveMovement(m: Movement) {
  const id = m.id ?? newId()
  await db.movs.put({ ...m, id, deleted: false })
  return id
}

export function deleteMovement(id: string) {
  return db.movs.update(id, { deleted: true })
}

export async function budgetsInMonth(month: string) {
  return (await db.budgets.where('month').equals(month).toArray()).filter(alive)
}

export function saveBudget(month: string, category: string, amount: number) {
  const id = `${month}|${category}`
  if (amount <= 0) return db.budgets.update(id, { deleted: true })
  return db.budgets.put({ id, month, category, amount, deleted: false })
}

export async function copyBudgets(fromMonth: string, toMonth: string) {
  const previous = await budgetsInMonth(fromMonth)
  await db.budgets.bulkPut(previous.map((b) => ({ ...b, id: `${toMonth}|${b.category}`, month: toMonth, deleted: false })))
  return previous.length
}

export interface Backup {
  app: 'finanzas'
  version: 1 | 2 | 3
  exportedAt: string
  movements: Movement[]
  budgets: Budget[]
  inbox?: InboxItem[]
  rules?: Rule[]
  debts?: Debt[]
  cards?: CardSummary[]
  cobros?: Receivable[]
  saldos?: AccountBalance[]
}

export async function exportBackup(): Promise<Backup> {
  return {
    app: 'finanzas',
    version: 3,
    exportedAt: new Date().toISOString(),
    movements: (await db.movs.toArray()).filter(alive),
    budgets: (await db.budgets.toArray()).filter(alive),
    inbox: await db.inbox.toArray(),
    rules: await db.rules.toArray(),
    debts: await db.debts.toArray(),
    cards: await activeCards(),
    cobros: await activeReceivables(),
    saldos: await activeBalances(),
  }
}

const ALL = () => [db.movs, db.budgets, db.inbox, db.rules, db.debts, db.cards, db.cobros, db.saldos]

// Marca todo como borrado (lápidas), para que en tus otros dispositivos también se borre.
async function tombstoneAll() {
  await db.movs.toCollection().modify({ deleted: true })
  await db.budgets.toCollection().modify({ deleted: true })
  await db.inbox.toCollection().modify({ deleted: true, status: 'ignorado' })
  await db.rules.toCollection().modify({ deleted: true })
  await db.cards.toCollection().modify({ deleted: true })
  await db.cobros.toCollection().modify({ deleted: true })
  await db.saldos.toCollection().modify({ deleted: true })
}

export async function importBackup(data: Backup) {
  if (data?.app !== 'finanzas' || !Array.isArray(data.movements)) {
    throw new Error('El archivo no es una copia de esta app.')
  }
  await db.transaction('rw', ALL(), async () => {
    await tombstoneAll()
    await db.debts.clear()
    // Copias viejas tenían ids numéricos: se convierten a texto.
    const ids = new Map<unknown, string>()
    const fresh = <T extends object>(r: T) => ({ ...r, deleted: false, updatedAt: Date.now() })
    await db.movs.bulkPut(
      data.movements.map((m) => {
        const id = typeof m.id === 'string' ? m.id : newId()
        ids.set(m.id, id)
        return { ...fresh(m), id }
      }),
    )
    await db.budgets.bulkPut((data.budgets ?? []).map(fresh))
    await db.inbox.bulkPut(
      (data.inbox ?? []).map((i) => ({
        ...fresh(i),
        movementId: i.movementId === undefined ? undefined : (ids.get(i.movementId) ?? String(i.movementId)),
      })),
    )
    await db.rules.bulkPut((data.rules ?? []).map(fresh))
    await db.debts.bulkPut(data.debts ?? [])
    await db.cards.bulkPut((data.cards ?? []).map(fresh))
    await db.cobros.bulkPut((data.cobros ?? []).map(fresh))
    await db.saldos.bulkPut((data.saldos ?? []).map(fresh))
  })
}

export async function deleteAll() {
  await db.transaction('rw', ALL(), async () => {
    await tombstoneAll()
    await db.debts.clear()
  })
}

// Archivo con una sola deuda (por ejemplo, la exportada del tablero de Claude).
export async function importDebtFile(data: unknown) {
  const d = (data as { tipo?: string; deuda?: Omit<Debt, 'id'> & { id?: string } })
  if (d?.tipo !== 'deuda' || !d.deuda?.name || !Array.isArray(d.deuda.disbursements)) {
    throw new Error('El archivo no es una deuda de esta app.')
  }
  const debt: Debt = {
    id: d.deuda.id ?? d.deuda.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name: d.deuda.name,
    direction: d.deuda.direction ?? 'debo',
    keywords: d.deuda.keywords ?? [d.deuda.name.toUpperCase()],
    rates: d.deuda.rates ?? [],
    installment: d.deuda.installment ?? 0,
    dueDay: d.deuda.dueDay ?? 25,
    disbursements: d.deuda.disbursements,
    payments: (d.deuda.payments ?? []).map((p, i) => ({ ...p, id: p.id ?? `archivo-${i}`, pending: true })),
    pendingUpload: true,
  }
  await db.debts.put(debt)
  return debt
}

// Se guarda primero aquí y se marca para subir a la hoja (ver debtSync.ts).
export async function addDebtPayment(debtId: string, payment: DebtEvent) {
  const debt = await db.debts.get(debtId)
  if (!debt) return false
  const id = payment.id ?? `app-${Date.now()}`
  if (debt.payments.some((p) => p.id === id)) return false
  await db.debts.update(debtId, { payments: [...debt.payments, { ...payment, id, pending: true }] })
  return true
}

export interface NewDebt {
  name: string
  direction: Debt['direction']
  amount: number
  date: string
  ea: number // 0 si es sin intereses
  installment: number // 0 si no hay cuota acordada
  dueDay: number
  keywords: string[]
  note?: string
}

export async function createDebt(n: NewDebt) {
  const base = n.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'deuda'
  let id = base
  for (let i = 2; await db.debts.get(id); i++) id = `${base}-${i}`
  const debt: Debt = {
    id,
    name: n.name.trim(),
    direction: n.direction,
    keywords: n.keywords.length ? n.keywords : [n.name.trim().toUpperCase()],
    rates: [{ from: n.date, ea: n.ea }],
    installment: n.installment,
    dueDay: n.dueDay,
    disbursements: [{ date: n.date, amount: n.amount, note: n.note || 'Préstamo' }],
    payments: [],
    pendingUpload: true,
  }
  await db.debts.put(debt)
  return debt
}

export async function addDebtDisbursement(debtId: string, d: DebtEvent) {
  const debt = await db.debts.get(debtId)
  if (!debt) return
  await db.debts.update(debtId, { disbursements: [...debt.disbursements, d], pendingUpload: true })
}
