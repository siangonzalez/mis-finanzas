import type { Movement } from '../data/db'

// Del libro: un gasto hormiga es un gasto ocasional pequeño que se repite.
export const ANT_EXPENSE_LIMIT = 20_000

export interface MonthStats {
  income: number
  expenses: number
  remaining: number
  fixed: number
  occasional: number
  ant: { count: number; total: number }
  byCategory: { name: string; total: number }[]
  incomeByCategory: { name: string; total: number }[]
}

function groupTotals(list: Movement[]) {
  const map = new Map<string, number>()
  for (const m of list) map.set(m.category, (map.get(m.category) ?? 0) + m.amount)
  return [...map].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total)
}

export function monthStats(movements: Movement[]): MonthStats {
  const incomes = movements.filter((m) => m.kind === 'ingreso')
  const expenses = movements.filter((m) => m.kind === 'gasto')
  const sum = (l: Movement[]) => l.reduce((acc, m) => acc + m.amount, 0)
  const ant = expenses.filter((m) => m.recurrence === 'ocasional' && m.amount <= ANT_EXPENSE_LIMIT)
  const income = sum(incomes)
  const spent = sum(expenses)
  return {
    income,
    expenses: spent,
    remaining: income - spent,
    fixed: sum(expenses.filter((m) => m.recurrence === 'fijo')),
    occasional: sum(expenses.filter((m) => m.recurrence === 'ocasional')),
    ant: { count: ant.length, total: sum(ant) },
    byCategory: groupTotals(expenses),
    incomeByCategory: groupTotals(incomes),
  }
}
