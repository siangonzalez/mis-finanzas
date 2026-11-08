import { describe, expect, it } from 'vitest'
import type { AccountBalance, CardRecord, InboxItem, Movement } from '../data/db'
import { reconcile, reconcileStart, recordedFlow } from './balances'

const saldo = (date: string, account: string, amount: number): AccountBalance => ({ id: `${date}|${account}`, date, account, amount })

const mov = (date: string, amount: number, over: Partial<Movement> = {}): Movement => ({
  id: `${date}-${amount}`, date, kind: 'gasto', category: 'Comida', subcategory: 'Mercado', description: 'Compra', amount, recurrence: 'ocasional', source: 'gmail', createdAt: 0, ...over,
})
const income = (date: string, amount: number) => mov(date, amount, { kind: 'ingreso', category: 'Honorarios', subcategory: 'Honorarios' })

const item = (over: Partial<InboxItem>): InboxItem => ({
  id: 'i', source: 'gmail', bank: 'Bancolombia', role: 'movimiento', kind: 'gasto', date: '2026-11-03', amount: 100_000, merchant: 'X',
  category: 'Otros', subcategory: 'Otros', status: 'aceptado', receivedAt: 0, ...over,
})

describe('con una sola anotación', () => {
  it('detecta lo mínimo que falta si lo registrado supera lo que hay', () => {
    const r = reconcile([saldo('2026-11-05', 'Bancolombia', 100_000), saldo('2026-11-05', 'Nequi', 29_349)], [income('2026-11-03', 500_000), mov('2026-11-04', 207_642)], [], [])
    expect(r?.total).toBe(129_349)
    expect(r?.gap).toBe(-163_009)
    expect(r?.atLeast).toBe(true)
  })

  it('no dice nada si puede cuadrar con lo que había al empezar el mes', () => {
    expect(reconcile([saldo('2026-11-05', 'Nequi', 900_000)], [income('2026-11-03', 500_000)], [], [])?.gap).toBe(0)
  })

  it('cuenta los movimientos del primer día del mes', () => {
    expect(reconcile([saldo('2026-11-05', 'Nequi', 100_000)], [income('2026-11-01', 500_000)], [], [])?.gap).toBe(-400_000)
  })
})

describe('con dos anotaciones', () => {
  const before = saldo('2026-11-01', 'Nequi', 500_000)

  it('cuadra si lo registrado explica el cambio', () => {
    expect(reconcile([before, saldo('2026-11-05', 'Nequi', 300_000)], [mov('2026-11-03', 200_000)], [], [])?.gap).toBe(0)
  })

  it('avisa gastos o ingresos que faltan', () => {
    expect(reconcile([before, saldo('2026-11-05', 'Nequi', 200_000)], [mov('2026-11-03', 200_000)], [], [])?.gap).toBe(-100_000)
    expect(reconcile([before, saldo('2026-11-05', 'Nequi', 450_000)], [mov('2026-11-03', 200_000)], [], [])?.gap).toBe(150_000)
  })

  it('ignora movimientos del día de la anotación anterior y diferencias pequeñas', () => {
    expect(reconcile([before, saldo('2026-11-05', 'Nequi', 499_500)], [mov('2026-11-01', 200_000)], [], [])?.gap).toBe(0)
  })

  it('una cuenta nueva no se confunde con plata que apareció', () => {
    const r = reconcile([before, saldo('2026-11-05', 'Nequi', 500_000), saldo('2026-11-05', 'Bancolombia', 1_000_000)], [], [], [])
    expect(r?.total).toBe(1_500_000)
    expect(r?.gap).toBe(0)
  })

  it('una cuenta que no actualizaste sigue contando con su último saldo', () => {
    const r = reconcile([saldo('2026-11-01', 'Bancolombia', 100_000), before, saldo('2026-11-05', 'Nequi', 450_000)], [], [], [])
    expect(r?.total).toBe(550_000)
    expect(r?.accounts.find((a) => a.account === 'Bancolombia')?.date).toBe('2026-11-01')
  })
})

describe('lo que mueve tus cuentas', () => {
  const noCards: CardRecord[] = []

  it('una compra con tarjeta de crédito no sale de la cuenta', () => {
    const m = mov('2026-11-03', 100_000, { id: 'm' })
    expect(recordedFlow('2026-11-01', '2026-11-05', [m], [item({ movementId: 'm', bank: 'Tuya' })], noCards)).toBe(0)
    expect(recordedFlow('2026-11-01', '2026-11-05', [m], [item({ movementId: 'm', account: 'T. Crédito *1234' })], noCards)).toBe(0)
    expect(recordedFlow('2026-11-01', '2026-11-05', [m], [item({ movementId: 'm', account: 'T. Débito *1234' })], noCards)).toBe(-100_000)
  })

  it('el pago a la tarjeta sí sale, y entre tus cuentas se cancela', () => {
    const pay = item({ status: 'propia', merchant: 'Pago tarjeta' })
    expect(recordedFlow('2026-11-01', '2026-11-05', [], [pay], noCards)).toBe(-100_000)
    expect(recordedFlow('2026-11-01', '2026-11-05', [], [pay, item({ id: 'j', status: 'propia', kind: 'ingreso', bank: 'Nequi' })], noCards)).toBe(0)
    expect(recordedFlow('2026-11-01', '2026-11-05', [], [item({ status: 'propia', kind: 'ingreso', bank: 'Tuya' })], noCards)).toBe(0)
  })

  it('cuenta el "Ya pagué" que marcas a mano', () => {
    const card = { manualPayment: { date: '2026-11-03', amount: 80_000 } } as CardRecord
    expect(recordedFlow('2026-11-01', '2026-11-05', [], [], [card])).toBe(-80_000)
  })
})

it('pide movimientos desde la anotación anterior aunque sea de otro mes', () => {
  expect(reconcileStart([saldo('2026-11-05', 'Nequi', 1)])).toBe('2026-11-01')
  expect(reconcileStart([saldo('2026-10-20', 'Nequi', 1), saldo('2026-11-05', 'Nequi', 1)])).toBe('2026-10-20')
})

describe('saldo de hoy', () => {
  const noted = [saldo('2026-11-05', 'Nequi', 129_349)]

  it('resta lo que gastaste después de anotar el saldo', () => {
    const r = reconcile(noted, [mov('2026-11-06', 30_000), mov('2026-11-07', 20_000), income('2026-11-07', 10_000)], [], [], '2026-11-08')
    expect(r?.total).toBe(129_349)
    expect(r?.changeSince).toBe(-40_000)
    expect(r?.now).toBe(89_349)
  })

  it('no resta lo del mismo día en que lo anotaste, que ya estaba en el banco', () => {
    expect(reconcile(noted, [mov('2026-11-05', 30_000)], [], [], '2026-11-08')?.now).toBe(129_349)
  })

  it('no cambia el aviso de lo que falta por registrar', () => {
    const before = reconcile(noted, [income('2026-11-03', 500_000)], [], [], '2026-11-05')
    const after = reconcile(noted, [income('2026-11-03', 500_000), mov('2026-11-06', 50_000)], [], [], '2026-11-08')
    expect(after?.gap).toBe(before?.gap)
  })
})

describe('cuadre paso a paso', () => {
  it('con el saldo del inicio del mes, el cuadre es exacto y se ve por partes', () => {
    const card = item({ id: 'tc', movementId: 'tc-mov', bank: 'Tuya' })
    const r = reconcile(
      [saldo('2026-10-31', 'Nequi', 200_000), saldo('2026-11-05', 'Nequi', 129_349)],
      [income('2026-11-03', 500_000), mov('2026-11-04', 207_642), mov('2026-11-04', 50_000, { id: 'tc-mov' })],
      [card, item({ id: 'pago', status: 'propia', amount: 80_000, date: '2026-11-04' })],
      [],
    )
    expect(r?.start).toBe(200_000)
    expect(r?.atLeast).toBe(false)
    expect(r?.flow).toEqual({ income: 500_000, expenses: 207_642, own: -80_000, marked: 0, credit: 50_000 })
    // 200.000 + 500.000 − 207.642 − 80.000 = 412.358; hay 129.349.
    expect(r?.gap).toBe(-283_009)
  })

  it('sin saldo inicial no hay punto de partida', () => {
    expect(reconcile([saldo('2026-11-05', 'Nequi', 1)], [], [], [])?.start).toBeNull()
  })
})
