import { describe, expect, it } from 'vitest'
import type { InboxItem, Movement, Receivable } from '../data/db'
import { taxYear, uvtFor, type TaxInput } from './tax'

const mov = (date: string, amount: number, over: Partial<Movement> = {}): Movement => ({
  id: `${date}-${amount}-${over.category ?? ''}`, date, kind: 'gasto', category: 'Comida', subcategory: 'Mercado', description: 'X', amount, recurrence: 'ocasional', source: 'gmail', createdAt: 0, ...over,
})
const income = (date: string, amount: number, category = 'Honorarios') => mov(date, amount, { kind: 'ingreso', category, subcategory: category })

const input = (over: Partial<TaxInput>): TaxInput => ({ year: 2026, today: '2026-12-31', movements: [], inbox: [], balances: [], receivables: [], ...over })
const check = (t: ReturnType<typeof taxYear>, key: string) => t.checks.find((c) => c.key === key)!

describe('topes de renta', () => {
  it('usa la UVT del año, o la última conocida', () => {
    expect(uvtFor(2026)).toEqual({ uvt: 52_374, uvtYear: 2026 })
    expect(uvtFor(2027).uvtYear).toBe(2026)
    expect(check(taxYear(input({})), 'ingresos').limit).toBe(73_323_600)
    expect(check(taxYear(input({})), 'patrimonio').limit).toBe(235_683_000)
  })

  it('un préstamo no es ingreso, pero sí es una consignación', () => {
    const t = taxYear(input({ movements: [income('2026-03-01', 1_000_000), income('2026-03-02', 5_000_000, 'Préstamos')] }))
    expect(check(t, 'ingresos').value).toBe(1_000_000)
    expect(check(t, 'consignaciones').value).toBe(6_000_000)
  })

  it('separa las compras con tarjeta de crédito y no cuenta los pagos de deudas como consumo', () => {
    const card = mov('2026-05-01', 300_000, { id: 'c' })
    const t = taxYear(input({
      movements: [card, mov('2026-05-02', 100_000), mov('2026-05-03', 300_000, { category: 'Deudas' })],
      inbox: [{ id: 'i', movementId: 'c', bank: 'Tuya', status: 'aceptado' } as InboxItem],
    }))
    expect(check(t, 'tarjeta').value).toBe(300_000)
    expect(check(t, 'consumos').value).toBe(400_000)
  })

  it('proyecta el año al ritmo de los meses con datos', () => {
    // Datos desde el 1 de julio, hoy 31 de diciembre: 6 meses → se duplica.
    const t = taxYear(input({ today: '2026-12-31', movements: [income('2026-07-01', 30_000_000)] }))
    expect(check(t, 'ingresos').estimated).toBe(60_000_000)
    expect(t.status).toBe('cerca')
    // Un año que ya terminó no se proyecta.
    expect(check(taxYear(input({ today: '2027-02-01', movements: [income('2026-07-01', 30_000_000)] })), 'ingresos').estimated).toBe(30_000_000)
  })

  it('avisa si supera un tope', () => {
    expect(taxYear(input({ today: '2027-01-10', movements: [income('2026-07-01', 80_000_000)] })).status).toBe('supera')
    expect(taxYear(input({ today: '2027-01-10', movements: [income('2026-07-01', 10_000_000)] })).status).toBe('lejos')
  })

  it('el patrimonio usa el último saldo anotado de cada cuenta en el año', () => {
    const t = taxYear(input({
      balances: [
        { id: 'a', date: '2026-03-01', account: 'Nequi', amount: 100 },
        { id: 'b', date: '2026-11-05', account: 'Nequi', amount: 300 },
        { id: 'c', date: '2026-11-05', account: 'Bancolombia', amount: 50 },
        { id: 'd', date: '2025-12-31', account: 'Otra', amount: 999 },
      ],
    }))
    expect(check(t, 'patrimonio').value).toBe(350)
  })

  it('lista lo que te retuvieron en cuentas de cobro pagadas ese año', () => {
    const r = (id: string, paidDate: string, paid: number): Receivable => ({
      id, client: id, concept: '', amount: 1_000_000, sentDate: '2026-01-01', keywords: [], createdAt: 0, paid: { date: paidDate, amount: paid },
    })
    const t = taxYear(input({ receivables: [r('A', '2026-04-01', 890_000), r('B', '2026-04-01', 1_000_000), r('C', '2025-12-01', 890_000)] }))
    expect(t.withheld).toEqual([{ client: 'A', amount: 110_000 }])
  })
})
