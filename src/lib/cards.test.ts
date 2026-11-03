import { describe, expect, it } from 'vitest'
import type { CardSummary } from '../import/statements'
import { cardPaid, type PaymentLike } from './cards'

const card = (bank: string, over: Partial<CardSummary> = {}): CardSummary => ({
  id: `${bank}-1`, bank, last4: '1111', cutDate: '2026-10-09', dueDate: '2026-11-04',
  totalDebt: 170_000, minPayment: 50_000, limit: 0, available: 0, ea: 0.29, ...over,
})
const pay = (merchant: string, amount: number, date = '2026-10-16', extra: Partial<PaymentLike> = {}): PaymentLike => ({
  merchant, amount, date, kind: 'gasto', status: 'aceptado', ...extra,
})

describe('¿ya pagaste la tarjeta?', () => {
  it('Tuya: "Pagaste … a Compania de Financiamiento Tuy" después del corte', () => {
    const p = cardPaid(card('Tuya'), [pay('Compania de Financiamiento Tuy', 190_000)])
    expect(p).toMatchObject({ paid: 190_000, covered: true, lastDate: '2026-10-16', manual: false })
  })

  it('un pago antes del corte ya está en el extracto y no cuenta', () => {
    expect(cardPaid(card('Tuya'), [pay('Compania de Financiamiento Tuy', 190_000, '2026-10-01')]).paid).toBe(0)
  })

  it('crédito Davivienda: el pago del banco cuenta, los comprobantes repetidos no', () => {
    const loan = card('Davivienda', { kind: 'prestamo', cutDate: '2026-09-30', minPayment: 527_000 })
    const p = cardPaid(loan, [
      pay('Banco Davivienda SA Zona Pa', 527_000, '2026-10-29'),
      pay('Banco Davivienda S.A. (Zona Pagos)', 527_000, '2026-10-29', { status: 'duplicado' }),
      pay('Davivienda Cartera Creditos', 527_000, '2026-10-29', { status: 'duplicado' }),
    ])
    expect(p).toMatchObject({ paid: 527_000, covered: true })
  })

  it('un pago parcial no cubre el mínimo', () => {
    expect(cardPaid(card('Tuya'), [pay('Compania de Financiamiento Tuy', 20_000)]).covered).toBe(false)
  })

  it('"Ya pagué" marcado a mano cuenta', () => {
    const p = cardPaid({ ...card('Bancolombia'), manualPayment: { date: '2026-11-03', amount: 50_000 } }, [])
    expect(p).toMatchObject({ covered: true, manual: true })
  })

  it('no confunde pagos a otros bancos', () => {
    expect(cardPaid(card('Tuya'), [pay('Banco Davivienda SA Zona Pa', 527_000)]).paid).toBe(0)
  })
})
