// Cálculo de deudas con interés compuesto diario y tasas efectivas anuales
// que cambian en el tiempo. Mismo método que el tablero "Deuda Juan Camilo":
// cada día se aplican primero los movimientos y luego se causa el interés.

export interface DebtEvent {
  date: string // YYYY-MM-DD
  amount: number
  note?: string
  id?: string // pagos: identificador estable para sincronizar con la hoja y el tablero
  source?: string // pagos: app, alerta, artefacto…
  pending?: boolean // pagos: todavía no se ha subido a la hoja
}

export interface RatePeriod {
  from: string // desde esta fecha (incluida)
  ea: number // tasa efectiva anual, 0.2 = 20 %
}

export interface DebtTerms {
  rates: RatePeriod[]
  installment: number // cuota mensual acordada
  dueDay: number // día del mes en que vence la cuota
  disbursements: DebtEvent[]
  payments: DebtEvent[]
}

export interface DebtRow extends DebtEvent {
  type: 'prestamo' | 'pago'
  interestSincePrevious: number
  balanceAfter: number
}

export interface DebtSimulation {
  balance: number
  interestTotal: number
  interestSinceLastEvent: number
  disbursed: number
  paid: number
  rows: DebtRow[]
  monthly: Record<string, { interest: number; paid: number; disbursed: number }>
  series: { date: string; balance: number }[]
}

const toUTC = (d: string) => new Date(`${d}T12:00:00Z`)
const iso = (d: Date) => d.toISOString().slice(0, 10)

function dailyRate(rates: RatePeriod[], date: string) {
  const sorted = [...rates].sort((a, b) => a.from.localeCompare(b.from))
  let ea = sorted[0]?.ea ?? 0
  for (const r of sorted) if (r.from <= date) ea = r.ea
  return Math.pow(1 + ea, 1 / 365) - 1
}

export function simulateDebt(t: DebtTerms, until: string): DebtSimulation {
  const events = [
    ...t.disbursements.map((e) => ({ ...e, type: 'prestamo' as const })),
    ...t.payments.filter((p) => p.amount > 0).map((e) => ({ ...e, type: 'pago' as const })),
  ].sort((a, b) => a.date.localeCompare(b.date) || (a.type === 'prestamo' ? -1 : 1))

  const sim: DebtSimulation = {
    balance: 0, interestTotal: 0, interestSinceLastEvent: 0,
    disbursed: t.disbursements.reduce((s, d) => s + d.amount, 0),
    paid: t.payments.reduce((s, p) => s + p.amount, 0),
    rows: [], monthly: {}, series: [],
  }
  if (!events.length) return sim

  let i = 0
  for (const d = toUTC(events[0].date); d <= toUTC(until); d.setUTCDate(d.getUTCDate() + 1)) {
    const date = iso(d)
    const month = date.slice(0, 7)
    const m = (sim.monthly[month] ??= { interest: 0, paid: 0, disbursed: 0 })
    while (i < events.length && events[i].date === date) {
      const e = events[i++]
      if (e.type === 'prestamo') {
        sim.balance += e.amount
        m.disbursed += e.amount
      } else {
        sim.balance -= e.amount
        m.paid += e.amount
      }
      sim.rows.push({ ...e, interestSincePrevious: sim.interestSinceLastEvent, balanceAfter: sim.balance })
      sim.interestSinceLastEvent = 0
      sim.series.push({ date, balance: sim.balance })
    }
    if (date.endsWith('-01')) sim.series.push({ date, balance: sim.balance })
    const interest = sim.balance * dailyRate(t.rates, date)
    sim.balance += interest
    sim.interestTotal += interest
    sim.interestSinceLastEvent += interest
    m.interest += interest
  }
  sim.series.push({ date: until, balance: sim.balance })
  return sim
}

// Cuotas atrasadas: las que han vencido desde el mes siguiente al primer
// préstamo, menos las que se han pagado. Cada pago cuenta como las cuotas que
// cubre, redondeando: uno de 4M con cuota de 2M son dos, uno de 1M (cuando la
// cuota era menor) cuenta como una, y uno de 27 mil no cuenta como cuota.
export function overdueInstallments(t: DebtTerms, today: string) {
  const first = t.disbursements.map((d) => d.date).sort()[0]
  if (t.installment <= 0 || !first) return { overdue: [] as string[], next: '' }
  let [y, m] = first.split('-').map(Number)
  const due: string[] = []
  let next = ''
  while (!next) {
    m++
    if (m > 12) {
      m = 1
      y++
    }
    const d = `${y}-${String(m).padStart(2, '0')}-${String(t.dueDay).padStart(2, '0')}`
    if (d >= today) next = d // el día del vencimiento todavía no es atraso
    else due.push(d)
  }
  const covered = t.payments.reduce((n, p) => n + Math.round(p.amount / t.installment), 0)
  const owed = Math.max(0, due.length - covered)
  return { overdue: owed ? due.slice(-owed) : [], next }
}

// Meses para terminar si se paga la cuota cada mes (más las vencidas en la
// próxima fecha), con la tasa vigente al final.
export function payoffProjection(t: DebtTerms, balance: number, today: string) {
  const { overdue, next } = overdueInstallments(t, today)
  const ea = [...t.rates].sort((a, b) => a.from.localeCompare(b.from)).pop()?.ea ?? 0
  const rm = Math.pow(1 + ea, 1 / 12) - 1
  if (!next || t.installment <= balance * rm) return { months: Infinity, installments: Infinity, endMonth: '', monthlyInterest: balance * rm }
  let [y, m] = next.split('-').map(Number)
  let s = balance
  let months = 0
  let first = true
  while (s > 0 && months < 600) {
    s = s * (1 + rm) - t.installment * (first ? overdue.length + 1 : 1)
    first = false
    months++
    if (s > 0) {
      m++
      if (m > 12) {
        m = 1
        y++
      }
    }
  }
  // Cuotas reales: la primera fecha incluye las atrasadas.
  return { months, installments: months + overdue.length, endMonth: `${y}-${String(m).padStart(2, '0')}`, monthlyInterest: balance * rm }
}
