import { describe, expect, it } from 'vitest'
import { overdueInstallments, payoffProjection, simulateDebt, type DebtTerms } from './debt'

// Números inventados: los datos reales de las deudas no van en el código.
const base: DebtTerms = {
  rates: [{ from: '2024-01-01', ea: 0.2 }],
  installment: 100_000,
  dueDay: 25,
  disbursements: [{ date: '2025-01-01', amount: 1_000_000 }],
  payments: [],
}

describe('simulateDebt', () => {
  it('un año al 20 % EA sin pagos da 20 % de interés', () => {
    const sim = simulateDebt(base, '2025-12-31')
    expect(Math.round(sim.balance)).toBe(1_200_000)
    expect(Math.round(sim.interestTotal)).toBe(200_000)
  })

  it('los pagos bajan el saldo y quedan en el historial', () => {
    const sim = simulateDebt({ ...base, payments: [{ date: '2025-02-25', amount: 300_000 }] }, '2025-03-01')
    const pago = sim.rows.find((r) => r.type === 'pago')!
    expect(pago.interestSincePrevious).toBeGreaterThan(0)
    expect(pago.balanceAfter).toBeLessThan(1_000_000)
    expect(sim.paid).toBe(300_000)
  })

  it('usa la tasa nueva desde la fecha del cambio', () => {
    const sameRate = simulateDebt(base, '2025-12-31').balance
    const lower = simulateDebt({ ...base, rates: [...base.rates, { from: '2025-07-01', ea: 0.1 }] }, '2025-12-31').balance
    expect(lower).toBeLessThan(sameRate)
  })
})

describe('cuotas', () => {
  it('marca como vencidas las cuotas después del último pago', () => {
    const t = { ...base, payments: [{ date: '2025-08-25', amount: 100_000 }] }
    expect(overdueInstallments(t, '2025-11-03')).toEqual({ overdue: ['2025-09-25', '2025-10-25'], next: '2025-11-25' })
    expect(overdueInstallments(t, '2025-09-20').overdue).toEqual([])
  })

  it('si la cuota no cubre el interés, nunca termina', () => {
    const p = payoffProjection({ ...base, installment: 10_000 }, 1_000_000, '2025-01-10')
    expect(p.months).toBe(Infinity)
  })

  it('proyecta en cuántos meses termina', () => {
    const p = payoffProjection({ ...base, installment: 100_000 }, 1_000_000, '2025-01-10')
    expect(p.months).toBeGreaterThan(10)
    expect(p.months).toBeLessThan(13)
  })
})
