import { describe, expect, it } from 'vitest'
import type { InboxItem, Receivable } from '../data/db'
import { paymentCandidates, proposedPayments, remaining } from './receivables'

const cobro = (over: Partial<Receivable> = {}): Receivable => ({
  id: 'zebra', client: 'Zebra Group', concept: 'Video presentación', amount: 800_000, sentDate: '2026-11-03', keywords: [], createdAt: 0, ...over,
})

const ingreso = (merchant: string, amount: number, date = '2026-11-10', over: Partial<InboxItem> = {}): InboxItem => ({
  id: `${merchant}-${amount}-${date}`, source: 'gmail', bank: 'Bancolombia', role: 'movimiento', kind: 'ingreso', date, amount, merchant,
  category: 'Otros', subcategory: 'Otros', status: 'pendiente', receivedAt: 0, ...over,
})

describe('pagos de cuentas de cobro', () => {
  it('reconoce el pago con el nombre del cliente aunque venga con retención', () => {
    const c = paymentCandidates(cobro(), [ingreso('Transferencia de ZEBRA GROUP SAS', 712_000)])
    expect(c).toHaveLength(1)
    expect(c[0].byName).toBe(true)
  })

  it('el nombre del cliente debe aparecer completo, sin palabras genéricas', () => {
    const r = cobro({ client: 'Universidad Sergio Arboleda', amount: 1_000_000 })
    expect(paymentCandidates(r, [ingreso('Transferencia de UNIV SERGIO ARBOLEDA', 890_000)])).toHaveLength(1)
    expect(paymentCandidates(r, [ingreso('Transferencia de SERGIO ROMERO', 900_000)])).toHaveLength(0)
  })

  it('acepta un valor exacto aunque no diga el nombre', () => {
    expect(paymentCandidates(cobro(), [ingreso('Recibiste por Bre-B', 800_000)])).toHaveLength(1)
  })

  it('no propone ingresos de otro valor sin el nombre, ni anteriores al cobro, ni gastos', () => {
    expect(
      paymentCandidates(cobro(), [
        ingreso('Recibiste por Bre-B', 720_000),
        ingreso('ZEBRA GROUP', 800_000, '2026-10-01'),
        ingreso('ZEBRA GROUP', 800_000, '2026-11-10', { kind: 'gasto' }),
        ingreso('ZEBRA GROUP', 500_000),
        ingreso('ZEBRA GROUP', 800_000, '2026-11-10', { status: 'propia' }),
      ]),
    ).toHaveLength(0)
  })

  it('no vuelve a proponer un pago que dijiste que no era', () => {
    const i = ingreso('ZEBRA GROUP', 800_000)
    expect(paymentCandidates(cobro({ rejected: [i.id] }), [i])).toHaveLength(0)
  })

  it('un mismo ingreso se propone para un solo cobro', () => {
    const a = cobro({ id: 'a', client: 'Pilar', amount: 100_000, sentDate: '2026-11-01' })
    const b = cobro({ id: 'b', client: 'Otra', amount: 100_000, sentDate: '2026-11-02' })
    const p = proposedPayments([a, b], [ingreso('Recibiste de PILAR INMOBILIARIA', 100_000)])
    expect([...p.keys()]).toEqual(['a'])
  })
})

describe('abonos', () => {
  it('lo que falta descuenta los abonos, y un pago cerrado ya no debe nada', () => {
    expect(remaining(cobro({ amount: 100_000, payments: [{ date: '2026-11-05', amount: 50_000 }] }))).toBe(50_000)
    expect(remaining(cobro({ paid: { date: '2026-11-10', amount: 90_000 } }))).toBe(0)
  })

  it('después de un abono, propone el pago de lo que falta y no repite el ingreso del abono', () => {
    const abono = ingreso('PILAR INMOBILIARIA', 50_000, '2026-11-05')
    const r = cobro({ client: 'Pilar', amount: 100_000, payments: [{ date: '2026-11-05', amount: 50_000, inboxId: abono.id }] })
    const resto = ingreso('PILAR INMOBILIARIA', 50_000, '2026-11-20')
    expect(paymentCandidates(r, [abono, resto]).map((c) => c.item.id)).toEqual([resto.id])
  })
})
