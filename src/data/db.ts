import Dexie, { type EntityTable } from 'dexie'
import type { Kind } from './categories'

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

const db = new Dexie('finanzas') as Dexie & {
  movements: EntityTable<Movement, 'id'>
  budgets: EntityTable<Budget, 'id'>
  inbox: EntityTable<InboxItem, 'id'>
  rules: EntityTable<Rule, 'id'>
  settings: EntityTable<Setting, 'key'>
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
  }
}

export async function importBackup(data: Backup) {
  if (data?.app !== 'finanzas' || !Array.isArray(data.movements)) {
    throw new Error('El archivo no es una copia de esta app.')
  }
  await db.transaction('rw', [db.movements, db.budgets, db.inbox, db.rules], async () => {
    await Promise.all([db.movements.clear(), db.budgets.clear(), db.inbox.clear(), db.rules.clear()])
    // Se conservan los ids para que la bandeja siga apuntando a sus movimientos.
    await db.movements.bulkPut(data.movements)
    await db.budgets.bulkPut(data.budgets ?? [])
    await db.inbox.bulkPut(data.inbox ?? [])
    await db.rules.bulkPut(data.rules ?? [])
  })
}

export async function deleteAll() {
  await db.transaction('rw', [db.movements, db.budgets, db.inbox, db.rules], async () => {
    await Promise.all([db.movements.clear(), db.budgets.clear(), db.inbox.clear(), db.rules.clear()])
  })
}
