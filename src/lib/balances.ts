import type { AccountBalance, CardRecord, InboxItem, Movement } from '../data/db'

// Saldo real: lo que hay en tus cuentas, anotado por ti, comparado con lo que
// la app tiene registrado. Lo que no cuadra son movimientos que faltan por
// registrar. Es aproximado: una transferencia entre tus cuentas de la que solo
// llegó una alerta, por ejemplo, se ve como si faltara algo.

export interface Reconciliation {
  total: number
  date: string // última vez que anotaste tus saldos
  accounts: { account: string; amount: number; date: string }[]
  // Lo que falta por registrar: negativo si falta plata por salir, positivo si
  // hay más plata de la esperada. 0 si cuadra o no se puede saber.
  gap: number
  since: string // desde cuándo se compara: la vez anterior, o el inicio del mes
  atLeast: boolean // con una sola anotación, solo se conoce el mínimo que falta
  // Hoy: lo anotado más lo registrado después de ese día (el mismo día no,
  // porque no se sabe si pasó antes o después de que miraste el banco).
  now: number
  changeSince: number
  // Para el cuadre paso a paso: lo que había en `since` (si se anotó) y lo
  // registrado entre `since` y `date`.
  start: number | null
  flow: FlowBreakdown
}

export interface FlowBreakdown {
  income: number // entró a tus cuentas
  expenses: number // salió de tus cuentas
  own: number // entre tus cuentas y pagos a tarjetas, neto (negativo si salió)
  marked: number // "Ya pagué" que marcaste a mano
  credit: number // compras con tarjeta de crédito: son gasto, pero no salen de tus cuentas
}

const MIN_GAP = 1_000 // menos de esto es redondeo o el 4x1000

// Las compras con tarjeta de crédito son gasto, pero la plata no sale de tus
// cuentas hasta que pagas la tarjeta.
export const isCredit = (i: Pick<InboxItem, 'bank' | 'account'>) => i.bank === 'Tuya' || i.bank === 'Bancolombia TC' || /cr[eé]dito/i.test(i.account ?? '')

// Lo registrado de después de `from` hasta `to`, por partes.
export function flowBreakdown(from: string, to: string, movements: Movement[], inbox: InboxItem[], cards: CardRecord[]): FlowBreakdown {
  const inRange = (d: string) => d > from && d <= to
  const creditIds = new Set(inbox.filter((i) => i.movementId && isCredit(i)).map((i) => i.movementId))
  const mine = movements.filter((m) => inRange(m.date))
  const sum = (l: Movement[]) => l.reduce((s, m) => s + m.amount, 0)
  const cash = mine.filter((m) => !creditIds.has(m.id))
  // Lo que queda "entre tus cuentas" no es gasto, pero un pago a la tarjeta sí
  // sale de la cuenta. Entre Nequi y Bancolombia, entrada y salida se cancelan.
  const own = inbox
    .filter((i) => i.status === 'propia' && !i.deleted && inRange(i.date) && !isCredit(i))
    .reduce((s, i) => s + (i.kind === 'ingreso' ? i.amount : -i.amount), 0)
  return {
    income: sum(cash.filter((m) => m.kind === 'ingreso')),
    expenses: sum(cash.filter((m) => m.kind === 'gasto')),
    own,
    marked: cards.reduce((s, c) => s + (c.manualPayment && inRange(c.manualPayment.date) ? c.manualPayment.amount : 0), 0),
    credit: sum(mine.filter((m) => m.kind === 'gasto' && creditIds.has(m.id))),
  }
}

export const netFlow = (f: FlowBreakdown) => f.income - f.expenses + f.own - f.marked

// Cuánto cambiaron tus cuentas según lo registrado, de después de `from` hasta `to`.
export function recordedFlow(from: string, to: string, movements: Movement[], inbox: InboxItem[], cards: CardRecord[]) {
  return netFlow(flowBreakdown(from, to, movements, inbox, cards))
}

export function reconcile(entries: AccountBalance[], movements: Movement[], inbox: InboxItem[], cards: CardRecord[], today = ''): Reconciliation | null {
  if (!entries.length) return null
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date))
  const accounts = [...new Set(sorted.map((e) => e.account))]
  // Cuánto había en una cuenta en esa fecha; si aún no la anotabas, su primer valor.
  const at = (account: string, date: string) => {
    const list = sorted.filter((e) => e.account === account)
    return ([...list].reverse().find((e) => e.date <= date) ?? list[0]).amount
  }
  const dates = [...new Set(sorted.map((e) => e.date))]
  const date = dates[dates.length - 1]
  const total = accounts.reduce((s, a) => s + at(a, date), 0)
  const latest = accounts.map((account) => ({ account, amount: at(account, date), date: sorted.filter((e) => e.account === account).pop()!.date }))

  let gap = 0
  let since: string
  let start: number | null = null
  let flow: FlowBreakdown
  const atLeast = dates.length < 2
  if (atLeast) {
    // Sin saldo anterior: si lo registrado este mes supera lo que hay, seguro falta algo.
    since = `${date.slice(0, 7)}-01`
    flow = flowBreakdown(`${date.slice(0, 7)}-00`, date, movements, inbox, cards)
    gap = Math.min(0, total - netFlow(flow))
  } else {
    since = dates[dates.length - 2]
    start = accounts.reduce((s, a) => s + at(a, since), 0)
    flow = flowBreakdown(since, date, movements, inbox, cards)
    gap = total - (start + netFlow(flow))
  }
  const changeSince = today > date ? recordedFlow(date, today, movements, inbox, cards) : 0
  return { total, date, accounts: latest, gap: Math.abs(gap) < MIN_GAP ? 0 : gap, since, atLeast, now: total + changeSince, changeSince, start, flow }
}

// Desde cuándo hacen falta movimientos para comparar.
export function reconcileStart(entries: AccountBalance[]) {
  const dates = [...new Set(entries.map((e) => e.date))].sort()
  const last = dates[dates.length - 1] ?? ''
  const monthStart = `${last.slice(0, 7)}-01`
  const previous = dates[dates.length - 2]
  return previous && previous < monthStart ? previous : monthStart
}
