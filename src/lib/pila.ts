import type { Movement } from '../data/db'
import { daysInMonth } from './format'

// Planilla de seguridad social (PILA) de un independiente. Se puede dejar en
// pausa (sin avisos) y la app solo calcula cuánto sería el aporte de los meses
// en que recibes honorarios. Es una guía: el valor exacto lo da tu operador de
// planilla.

export interface PilaConfig {
  active: boolean
  dueDay: number // día del mes en que vence (según los últimos dígitos de tu cédula)
}

// Sobre el 40 % de lo que recibes: salud 12,5 % y pensión 16 %. La ARL
// (riesgo I, 0,522 %) va aparte y depende del contrato.
export const PILA_BASE = 0.4
export const PILA_RATE = 0.125 + 0.16

// Cómo se ve el pago de la planilla en tus alertas y extractos.
const PILA_PAYEE = /APORTES EN L[IÍ]NEA|MI PLANILLA|ASOPAGOS|SIMPLE S\.?A|PLANILLA|PILA\b|\bSOI\b/i

export function pilaPayments(movements: Movement[], month: string) {
  return movements.filter((m) => m.kind === 'gasto' && !m.deleted && m.date.startsWith(month) && PILA_PAYEE.test(m.description))
}

export function honorariosIn(movements: Movement[], month: string) {
  return movements
    .filter((m) => m.kind === 'ingreso' && !m.deleted && m.category === 'Honorarios' && m.date.startsWith(month))
    .reduce((s, m) => s + m.amount, 0)
}

// Aporte aproximado de salud y pensión por lo que recibiste.
export const pilaEstimate = (honorarios: number) => Math.round(honorarios * PILA_BASE * PILA_RATE)

// Fecha límite de este mes y cuántos días faltan (negativo si ya pasó).
export function pilaDue(today: string, dueDay: number) {
  const month = today.slice(0, 7)
  const day = Math.min(Math.max(1, dueDay), daysInMonth(month))
  const due = `${month}-${String(day).padStart(2, '0')}`
  const days = Math.round((Date.parse(due) - Date.parse(today)) / 86_400_000)
  return { due, days }
}
