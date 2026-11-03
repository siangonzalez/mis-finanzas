import { describe, expect, it } from 'vitest'
import type { CardRecord, Debt, Movement, Receivable } from '../data/db'
import { completeMonths, diagnose, merchantKey, repeatedCharges, type DiagnosisInput } from './diagnosis'

const TODAY = '2026-11-15'

const mov = (date: string, amount: number, description = 'Compra', over: Partial<Movement> = {}): Movement => ({
  date, kind: 'gasto', category: 'Comida', subcategory: 'Mercado', description, amount, recurrence: 'ocasional', source: 'gmail', createdAt: 0, ...over,
})
const income = (date: string, amount: number, over: Partial<Movement> = {}) => mov(date, amount, 'Pago', { kind: 'ingreso', category: 'Honorarios', subcategory: 'Honorarios', ...over })

// Un mes con ingreso y gasto dados, repartido en varios movimientos.
const month = (m: string, incomeAmount: number, spent: number) => [
  income(`${m}-02`, incomeAmount),
  ...[3, 4, 5, 6, 7].map((d) => mov(`${m}-0${d}`, spent / 5, `Tienda ${d}`)),
]

const input = (over: Partial<DiagnosisInput> = {}): DiagnosisInput => ({
  today: TODAY, movements: [], budgets: [], debts: [], cards: [], inbox: [], receivables: [], ...over,
})
const card = (over: Partial<CardRecord> = {}): CardRecord => ({
  id: 'Tuya-1234', bank: 'Tuya', last4: '1234', cutDate: '2026-10-30', dueDate: '2026-11-20', totalDebt: 1_000_000, minPayment: 100_000, limit: 2_000_000, available: 1_000_000, ea: 0.3, ...over,
})
const cobro = (over: Partial<Receivable> = {}): Receivable => ({
  id: 'a', client: 'Zebra Group', concept: 'Video', amount: 800_000, sentDate: '2026-11-03', keywords: [], createdAt: 0, ...over,
})
const find = (i: DiagnosisInput, id: string) => diagnose(i).findings.find((f) => f.id === id)

describe('meses que se analizan', () => {
  it('no cuenta el mes actual, ni meses sin datos, ni uno que empieza a la mitad', () => {
    const movements = [...month('2026-09', 1, 1), ...month('2026-10', 1, 1), ...month('2026-11', 1, 1)]
    expect(completeMonths(movements, TODAY)).toEqual(['2026-09', '2026-10'])
    const partial = [...Array(6)].map((_, i) => mov(`2026-08-2${i}`, 1))
    expect(completeMonths([...partial, ...movements], TODAY)).toEqual(['2026-09', '2026-10'])
  })
})

describe('balance', () => {
  it('avisa cuando sale más de lo que entra', () => {
    const f = find(input({ movements: [...month('2026-09', 1_000_000, 900_000), ...month('2026-10', 1_000_000, 1_500_000)] }), 'balance')
    expect(f?.tone).toBe('alerta')
  })

  it('un préstamo que te hacen no cuenta como ingreso', () => {
    const movements = [...month('2026-10', 1_000_000, 500_000), income('2026-10-09', 5_000_000, { category: 'Préstamos' })]
    expect(diagnose(input({ movements })).avgIncome).toBe(1_000_000)
  })

  it('avisa si el mes más bajo no alcanza para el gasto promedio', () => {
    const movements = [...month('2026-09', 3_000_000, 1_000_000), ...month('2026-10', 500_000, 1_000_000)]
    expect(find(input({ movements }), 'mes-bajo')).toBeDefined()
  })
})

describe('deudas', () => {
  it('ordena por tasa y calcula los intereses del mes', () => {
    const d = diagnose(input({ cards: [card({ id: 'b', last4: '2222', ea: 0.2 }), card({ id: 'a', last4: '1111', ea: 0.3 })] }))
    expect(d.findings.find((f) => f.id === 'intereses')?.items?.[0].label).toContain('1111')
    expect(d.monthlyInterest).toBeGreaterThan(30_000)
    expect(d.monthlyInterest).toBeLessThan(40_000)
  })

  it('descuenta lo pagado después del corte', () => {
    const paid = card({ manualPayment: { date: '2026-11-05', amount: 1_000_000 } })
    expect(diagnose(input({ cards: [paid] })).monthlyInterest).toBe(0)
  })

  it('marca un pago vencido solo si no se ha pagado', () => {
    const late = card({ dueDate: '2026-11-10' })
    expect(find(input({ cards: [late] }), 'atrasos')?.tone).toBe('alerta')
    expect(find(input({ cards: [{ ...late, manualPayment: { date: '2026-11-05', amount: 100_000 } }] }), 'atrasos')).toBeUndefined()
  })

  it('avisa cuando casi todo el mínimo se va en intereses', () => {
    expect(find(input({ cards: [card({ minPayment: 30_000 })] }), 'minimo')).toBeDefined()
    expect(find(input({ cards: [card({ minPayment: 100_000 })] }), 'minimo')).toBeUndefined()
  })

  it('cuenta las cuotas atrasadas de una deuda', () => {
    const debt: Debt = {
      id: 'j', name: 'Juan', direction: 'debo', keywords: [], rates: [{ from: '2026-01-01', ea: 0.2 }], installment: 100_000, dueDay: 25,
      disbursements: [{ date: '2026-08-01', amount: 1_000_000 }], payments: [],
    }
    expect(find(input({ debts: [debt] }), 'atrasos')?.items).toEqual([{ label: 'Deuda con Juan', value: '2 cuotas' }])
  })
})

describe('cuentas de cobro', () => {
  it('un cobro sin fecha se atrasa a los 30 días', () => {
    expect(find(input({ receivables: [cobro()] }), 'cobros-atrasados')).toBeUndefined()
    expect(find(input({ receivables: [cobro({ sentDate: '2026-09-01' })] }), 'cobros-atrasados')).toBeDefined()
  })

  it('suma lo que te pagaron de menos este año', () => {
    const paid = cobro({ paid: { date: '2026-11-10', amount: 712_000 } })
    expect(find(input({ receivables: [paid] }), 'historial-cobros')?.detail).toMatch(/88\.000/)
  })
})

describe('gastos', () => {
  it('agrupa el mismo comercio aunque cambie el código', () => {
    expect(merchantKey('Spotify P477A1DE68')).toBe(merchantKey('SPOTIFY P99B'))
    expect(merchantKey('UBER*RIDES')).toBe(merchantKey('UBER RIDES'))
    expect(merchantKey('Transferencia a la cuenta *111')).not.toBe(merchantKey('Transferencia a la cuenta *222'))
  })

  it('encuentra suscripciones aunque tengan varios valores, y no lo que se compra seguido', () => {
    const sub = { category: 'Suscripciones', subcategory: 'Otras' }
    const uber = [...Array(12)].map((_, i) => mov(`2026-${i % 2 ? '09' : '10'}-1${i % 9}`, 6_000, 'UBER*RIDES'))
    const found = repeatedCharges([
      mov('2026-09-21', 20_900, 'OPENAI *CHATGPT', sub), mov('2026-10-21', 20_900, 'OPENAI *CHATGPT', sub),
      mov('2026-09-18', 2_999, 'APPLE.COM/BILL', sub), mov('2026-10-18', 2_999, 'APPLE.COM/BILL', sub),
      mov('2026-09-24', 19_900, 'APPLE.COM/BILL', sub), mov('2026-10-24', 12_900, 'APPLE.COM/BILL', sub),
      ...uber,
    ], TODAY)
    expect(found.map((r) => [r.name, r.amount])).toEqual([['OPENAI *CHATGPT', 20_900], ['APPLE.COM/BILL', 2_999]])
  })

  it('un cobro que dejó de llegar ya no se repite', () => {
    const old = [mov('2026-07-01', 30_000, 'GIMNASIO'), mov('2026-08-01', 30_000, 'GIMNASIO')]
    expect(repeatedCharges(old, TODAY)).toEqual([])
  })

  it('avisa si mucho está en Otros', () => {
    const movements = [...month('2026-10', 1_000_000, 100_000), mov('2026-10-20', 400_000, 'NEGOCIO', { category: 'Otros' })]
    expect(find(input({ movements }), 'otros')?.items?.[0]).toEqual({ label: 'NEGOCIO', value: expect.stringContaining('400.000') })
  })

  it('compara cada categoría con los meses anteriores', () => {
    const movements = [...month('2026-08', 2_000_000, 300_000), ...month('2026-09', 2_000_000, 300_000), ...month('2026-10', 2_000_000, 600_000)]
    expect(find(input({ movements }), 'subidas')?.items?.[0].label).toBe('Comida')
  })
})

describe('presupuesto', () => {
  const budget = (amount: number) => [{ id: '2026-11|Comida', month: '2026-11', category: 'Comida', amount }]
  const movements = [mov('2026-11-03', 500_000)]

  it('distingue lo pasado de lo que va rápido', () => {
    expect(find(input({ movements, budgets: budget(400_000) }), 'presupuesto')?.tone).toBe('alerta')
    expect(find(input({ movements, budgets: budget(700_000) }), 'presupuesto')?.tone).toBe('atencion')
    expect(find(input({ movements, budgets: budget(5_000_000) }), 'presupuesto')?.tone).toBe('bien')
  })
})

it('las alertas salen primero', () => {
  const { findings } = diagnose(input({ cards: [card({ dueDate: '2026-11-10' })] }))
  expect(findings[0].tone).toBe('alerta')
  expect(findings[findings.length - 1].tone).not.toBe('alerta')
})
