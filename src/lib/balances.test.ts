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
