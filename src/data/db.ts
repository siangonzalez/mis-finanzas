import Dexie, { type EntityTable } from 'dexie'
import type { Kind } from './categories'
import type { DebtEvent, DebtTerms } from '../lib/debt'

// Todo vive en IndexedDB del navegador por ahora. Las funciones de este
// archivo son la única puerta a los datos, para poder cambiar a un servidor
// (Supabase) más adelante sin tocar las pantallas.

export type Recurrence = 'fijo' | 'ocasional'
export type Source = 'manual' | 'gmail' | 'applepay' | 'sms' | 'extracto'

export interface Movement {
  id?: number
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

export interface Budget {
  id: string // `${month}|${category}`
  month: string // YYYY-MM
  category: string
  amount: number
}

export type InboxStatus = 'pendiente' | 'aceptado' | 'ignorado' | 'duplicado'

// Movimiento detectado automáticamente (correo, Apple Pay, alerta pegada),
// esperando a que lo revises antes de entrar a tus cuentas.
export interface InboxItem {
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
  movementId?: number
  receivedAt: number
}

export interface Rule {
  id: string // `${kind}|${key}`
  key: string
  kind: Kind
  category: string
  subcategory: string
}

export interface Setting {
  key: string
  value: string
}

export interface Debt extends DebtTerms {
  id: string
  name: string // con quién es la deuda
  direction: 'debo' | 'me-deben'
  keywords: string[] // nombres con que aparece en las alertas, para reconocer pagos
  pendingUpload?: boolean // datos de la deuda aún no subidos a la hoja
}

const db = new Dexie('finanzas') as Dexie & {
  movements: EntityTable<Movement, 'id'>
  budgets: EntityTable<Budget, 'id'>
  inbox: EntityTable<InboxItem, 'id'>
  rules: EntityTable<Rule, 'id'>
  settings: EntityTable<Setting, 'key'>
  debts: EntityTable<Debt, 'id'>
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

export function movementsInMonth(month: string) {
  const [from, to] = monthRange(month)
  return db.movements.where('date').between(from, to, true, true).toArray()
}

export function movementsInYear(year: string) {
  return db.movements.where('date').between(`${year}-01-01`, `${year}-12-31`, true, true).toArray()
}

export function saveMovement(m: Movement) {
  return db.movements.put(m)
}

export function deleteMovement(id: number) {
  return db.movements.delete(id)
}

export function budgetsInMonth(month: string) {
  return db.budgets.where('month').equals(month).toArray()
}

export function saveBudget(month: string, category: string, amount: number) {
  const id = `${month}|${category}`
  if (amount <= 0) return db.budgets.delete(id)
  return db.budgets.put({ id, month, category, amount })
}

export async function copyBudgets(fromMonth: string, toMonth: string) {
  const previous = await budgetsInMonth(fromMonth)
  await db.budgets.bulkPut(previous.map((b) => ({ ...b, id: `${toMonth}|${b.category}`, month: toMonth })))
  return previous.length
}

export interface Backup {
  app: 'finanzas'
  version: 1 | 2
  exportedAt: string
  movements: Movement[]
  budgets: Budget[]
  inbox?: InboxItem[]
  rules?: Rule[]
  debts?: Debt[]
}

export async function exportBackup(): Promise<Backup> {
  return {
    app: 'finanzas',
    version: 2,
    exportedAt: new Date().toISOString(),
    movements: await db.movements.toArray(),
    budgets: await db.budgets.toArray(),
    inbox: await db.inbox.toArray(),
    rules: await db.rules.toArray(),
    debts: await db.debts.toArray(),
  }
}

export async function importBackup(data: Backup) {
  if (data?.app !== 'finanzas' || !Array.isArray(data.movements)) {
    throw new Error('El archivo no es una copia de esta app.')
  }
  await db.transaction('rw', [db.movements, db.budgets, db.inbox, db.rules, db.debts], async () => {
    await Promise.all([db.movements.clear(), db.budgets.clear(), db.inbox.clear(), db.rules.clear(), db.debts.clear()])
    // Se conservan los ids para que la bandeja siga apuntando a sus movimientos.
    await db.movements.bulkPut(data.movements)
    await db.budgets.bulkPut(data.budgets ?? [])
    await db.inbox.bulkPut(data.inbox ?? [])
    await db.rules.bulkPut(data.rules ?? [])
    await db.debts.bulkPut(data.debts ?? [])
  })
}

export async function deleteAll() {
  await db.transaction('rw', [db.movements, db.budgets, db.inbox, db.rules, db.debts], async () => {
    await Promise.all([db.movements.clear(), db.budgets.clear(), db.inbox.clear(), db.rules.clear(), db.debts.clear()])
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
