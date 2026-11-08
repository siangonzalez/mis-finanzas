import { describe, expect, it } from 'vitest'
import type { Movement } from '../data/db'
import { honorariosIn, pilaDue, pilaEstimate, pilaPayments } from './pila'

const mov = (date: string, amount: number, description: string, over: Partial<Movement> = {}): Movement => ({
  id: `${date}-${amount}`, date, kind: 'gasto', category: 'Salud', subcategory: 'EPS', description, amount, recurrence: 'ocasional', source: 'gmail', createdAt: 0, ...over,
})

describe('planilla de seguridad social', () => {
  it('reconoce el pago de la planilla en tus movimientos', () => {
    const list = [mov('2026-10-14', 578_400, 'APORTES EN LINEA'), mov('2026-10-15', 50_000, 'FARMATODO'), mov('2026-09-14', 578_400, 'APORTES EN LINEA')]
    expect(pilaPayments(list, '2026-10').map((m) => m.amount)).toEqual([578_400])
  })

  it('suma los honorarios del mes y calcula el aporte aproximado', () => {
    const list = [
      mov('2026-11-03', 300_000, 'CLIENTE', { kind: 'ingreso', category: 'Honorarios' }),
      mov('2026-11-04', 100_000, 'CLIENTE', { kind: 'ingreso', category: 'Honorarios' }),
      mov('2026-11-04', 100_000, 'PRESTAMO', { kind: 'ingreso', category: 'Préstamos' }),
    ]
    expect(honorariosIn(list, '2026-11')).toBe(400_000)
    // 40 % de 1.000.000 = 400.000; 28,5 % de eso = 114.000.
    expect(pilaEstimate(1_000_000)).toBe(114_000)
  })

  it('calcula la fecha límite del mes, sin pasarse del último día', () => {
    expect(pilaDue('2026-11-08', 14)).toEqual({ due: '2026-11-14', days: 6 })
    expect(pilaDue('2026-11-20', 14).days).toBe(-6)
    expect(pilaDue('2026-02-10', 31).due).toBe('2026-02-28')
  })
})
