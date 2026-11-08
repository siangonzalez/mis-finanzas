import type { AccountBalance, InboxItem, Movement, Receivable } from '../data/db'
import { isCredit } from './balances'
import { daysInMonth } from './format'

// Renta de personas naturales: ¿vas a tener que declarar por este año?
// Compara lo que hay en la app con los topes de la DIAN (artículos 592 a 594-3
// del Estatuto Tributario). Es una guía: no calcula el impuesto, y lo que no
// está en la app (meses anteriores, otras cuentas, bienes) no se cuenta.

// UVT de cada año (resoluciones de la DIAN). Agregar la nueva cada diciembre.
export const UVT: Record<number, number> = { 2025: 49_799, 2026: 52_374 }

const NEAR = 0.8 // desde el 80 % del tope se avisa

export function uvtFor(year: number) {
  const known = Object.keys(UVT).map(Number).filter((y) => y <= year)
  const uvtYear = known.length ? Math.max(...known) : Math.min(...Object.keys(UVT).map(Number))
  return { uvt: UVT[uvtYear], uvtYear }
}

export interface TaxCheck {
  key: 'ingresos' | 'consignaciones' | 'tarjeta' | 'consumos' | 'patrimonio'
  label: string
  value: number // lo que lleva el año según la app
  estimated: number // a este ritmo, al 31 de diciembre
  limit: number
  note: string
}

export interface TaxYear {
  year: number
  uvt: number
  uvtYear: number
  firstDate: string // desde cuándo hay datos en la app ('' si no hay)
  checks: TaxCheck[]
  status: 'supera' | 'cerca' | 'lejos'
  withheld: { client: string; amount: number }[] // posible retención en cuentas de cobro pagadas
}

export interface TaxInput {
  year: number
  today: string
  movements: Movement[] // los del año
  inbox: InboxItem[]
  balances: AccountBalance[]
  receivables: Receivable[]
}

// Meses cubiertos por los datos, contando la parte del mes actual que ya pasó.
function coveredMonths(firstDate: string, today: string) {
  const [fy, fm] = firstDate.split('-').map(Number)
  const [ty, tm, td] = today.split('-').map(Number)
  const whole = (ty - fy) * 12 + (tm - fm)
  return whole + td / daysInMonth(today.slice(0, 7))
}

export function taxYear({ year, today, movements, inbox, balances, receivables }: TaxInput): TaxYear {
  const { uvt, uvtYear } = uvtFor(year)
  const mine = movements.filter((m) => m.date.startsWith(String(year)) && !m.deleted)
  const firstDate = mine.map((m) => m.date).sort()[0] ?? ''
  const current = today.startsWith(String(year))
  // Mientras el año está en curso se proyecta al ritmo de los meses con datos.
  const factor = current && firstDate ? 12 / Math.max(1, coveredMonths(firstDate, today)) : 1
  const sum = (l: Movement[]) => l.reduce((s, m) => s + m.amount, 0)

  const incomes = mine.filter((m) => m.kind === 'ingreso')
  const expenses = mine.filter((m) => m.kind === 'gasto')
  const creditIds = new Set(inbox.filter((i) => i.movementId && isCredit(i)).map((i) => i.movementId))
  const fromDebitAccounts = incomes.filter((m) => !creditIds.has(m.id))

  // Patrimonio: lo último que anotaste de cada cuenta en el año.
  const latest = new Map<string, AccountBalance>()
  for (const b of balances.filter((b) => b.date.startsWith(String(year)) && !b.deleted).sort((a, b) => a.date.localeCompare(b.date))) latest.set(b.account, b)
  const assets = [...latest.values()].reduce((s, b) => s + b.amount, 0)

  const limit1400 = 1_400 * uvt
  const checks: TaxCheck[] = [
    {
      key: 'ingresos', label: 'Ingresos brutos', value: sum(incomes.filter((m) => m.category !== 'Préstamos')), estimated: 0, limit: limit1400,
      note: 'Todo lo que recibiste por tu trabajo y demás ingresos, antes de retenciones. Los préstamos no cuentan.',
    },
    {
      key: 'consignaciones', label: 'Consignaciones y depósitos', value: sum(fromDebitAccounts), estimated: 0, limit: limit1400,
      note: 'Toda la plata que entró a tus cuentas, también préstamos y transferencias de otras personas. No suma lo que mueves entre tus propias cuentas.',
    },
    {
      key: 'tarjeta', label: 'Consumos con tarjeta de crédito', value: sum(expenses.filter((m) => creditIds.has(m.id))), estimated: 0, limit: limit1400,
      note: 'Compras con tarjeta de crédito que llegaron por alertas o extractos.',
    },
    {
      key: 'consumos', label: 'Compras y consumos totales', value: sum(expenses.filter((m) => m.category !== 'Deudas')), estimated: 0, limit: limit1400,
      note: 'Todos tus gastos, sin contar los pagos de deudas (la compra ya está contada).',
    },
  ].map((c) => ({ ...c, key: c.key as TaxCheck['key'], estimated: Math.round(c.value * factor) }))
  checks.push({
    key: 'patrimonio', label: 'Patrimonio bruto (31 de diciembre)', value: assets, estimated: assets, limit: 4_500 * uvt,
    note: 'Solo los saldos de cuentas que anotaste. Suma tú bienes como carro, casa o inversiones.',
  })

  const worst = Math.max(...checks.map((c) => c.estimated / c.limit))
  const withheld = receivables
    .filter((r) => !r.deleted && r.paid?.date.startsWith(String(year)) && r.paid.amount < r.amount)
    .map((r) => ({ client: r.client, amount: r.amount - r.paid!.amount }))

  return { year, uvt, uvtYear, firstDate, checks, status: worst >= 1 ? 'supera' : worst >= NEAR ? 'cerca' : 'lejos', withheld }
}
