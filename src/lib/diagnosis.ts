import type { Budget, CardRecord, Debt, InboxItem, Movement, Receivable } from '../data/db'
import { cardPaid } from './cards'
import { overdueInstallments, payoffProjection, simulateDebt } from './debt'
import { daysBetween, proposedPayments } from './receivables'
import { ANT_EXPENSE_LIMIT, monthStats } from './stats'
import { currentMonth, daysInMonth, money, monthLabel, shiftMonth } from './format'

// Diagnóstico: reglas fijas sobre tus propios datos. Todo se calcula en el
// dispositivo. Muestra hechos, cálculos y opciones; decidir te toca a ti, y no
// dice en qué invertir. No conoce tus saldos, ahorros ni inversiones.

export type Tone = 'alerta' | 'atencion' | 'info' | 'bien'
export type GoTo = 'revisar' | 'movimientos' | 'presupuesto' | 'deudas'

export interface Finding {
  id: string
  tone: Tone
  area: string
  title: string
  detail: string
  items?: { label: string; value: string }[]
  go?: GoTo
}

export interface DiagnosisInput {
  today: string
  movements: Movement[]
  budgets: Budget[]
  debts: Debt[]
  cards: CardRecord[]
  inbox: InboxItem[]
  receivables: Receivable[]
}

export interface Diagnosis {
  months: string[] // meses completos analizados
  avgIncome: number
  avgExpenses: number
  monthlyInterest: number
  monthlyDebtPayments: number
  toCollect: number
  findings: Finding[]
}

const MIN_MOVEMENTS = 5 // un mes con menos no dice nada
const MAX_MONTHS = 6
const TONE_ORDER: Tone[] = ['alerta', 'atencion', 'info', 'bien']

const pct = (n: number) => `${Math.round(n * 100)} %`
const rate = (ea: number) => `${(ea * 100).toFixed(1).replace('.', ',')} % E.A.`
const avg = (l: number[]) => (l.length ? l.reduce((a, b) => a + b, 0) / l.length : 0)
const plural = (n: number, s: string, p = `${s}s`) => `${n} ${n === 1 ? s : p}`
const monthName = (m: string) => monthLabel(m).split(' ')[0].toLowerCase()
const shortDate = (d: string) => {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })
}

// Un préstamo que te hacen entra a la cuenta, pero no es un ingreso tuyo.
const realIncome = (l: Movement[]) => l.filter((m) => !(m.kind === 'ingreso' && m.category === 'Préstamos'))

// Meses terminados con datos. El primero se descarta si la información empieza
// a mitad de mes, porque se vería como un mes de pocos gastos.
export function completeMonths(movements: Movement[], today: string) {
  const counts = new Map<string, number>()
  for (const m of movements) counts.set(m.date.slice(0, 7), (counts.get(m.date.slice(0, 7)) ?? 0) + 1)
  const first = movements.map((m) => m.date).sort()[0]
  return [...counts]
    .filter(([m, n]) => m < today.slice(0, 7) && n >= MIN_MOVEMENTS && !(first?.startsWith(m) && Number(first.slice(8)) > 10))
    .map(([m]) => m)
    .sort()
    .slice(-MAX_MONTHS)
}

// Quita acentos, signos y códigos ("Spotify P477A1DE68" y "UBER*RIDES" / "UBER RIDES").
// En las transferencias los números sí importan: identifican a quién le pagas.
export function merchantKey(description: string) {
  const s = description.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]+/g, ' ').trim()
  return s.startsWith('TRANSFERENCIA') ? s : s.split(' ').filter((w) => !/\d/.test(w)).join(' ') || s
}

export interface Repeated {
  name: string
  amount: number // último valor cobrado
  months: number
}

// Cobros parecidos que vuelven mes a mes, aunque no estén marcados como fijos
// (lo que llega de alertas y extractos entra como ocasional).
export function repeatedCharges(movements: Movement[], today: string): Repeated[] {
  const groups = new Map<string, Movement[]>()
  for (const m of movements) {
    if (m.kind !== 'gasto' || m.category === 'Deudas') continue
    const key = merchantKey(m.description)
    groups.set(key, [...(groups.get(key) ?? []), m])
  }
  const out: Repeated[] = []
  for (const list of groups.values()) {
    const subscription = list.some((m) => m.category === 'Suscripciones')
    // Lo que se compra varias veces al mes (Uber, la tienda) no es un cobro fijo.
    if (!subscription && list.length > new Set(list.map((m) => m.date.slice(0, 7))).size * 3) continue
    const sorted = [...list].sort((a, b) => a.amount - b.amount)
    let cluster: Movement[] = []
    const close = () => {
      const months = new Set(cluster.map((m) => m.date.slice(0, 7))).size
      const last = cluster.reduce((a, b) => (a.date > b.date ? a : b), cluster[0])
      if (months >= 2 && cluster.length <= months + 1 && daysBetween(last.date, today) <= 45 && (subscription || last.amount >= 10_000)) {
        out.push({ name: last.description, amount: last.amount, months })
      }
    }
    for (const m of sorted) {
      if (cluster.length && m.amount > cluster[0].amount * 1.1) {
        close()
        cluster = []
      }
      cluster.push(m)
    }
    if (cluster.length) close()
  }
  return out.sort((a, b) => b.amount - a.amount)
}

function topByMerchant(list: Movement[], n: number) {
  const map = new Map<string, { label: string; total: number; count: number }>()
  for (const m of list) {
    const key = merchantKey(m.description)
    const e = map.get(key) ?? { label: m.description, total: 0, count: 0 }
    map.set(key, { ...e, total: e.total + m.amount, count: e.count + 1 })
  }
  return [...map.values()].sort((a, b) => b.total - a.total).slice(0, n)
}

interface DebtLine {
  name: string
  balance: number
  ea: number
  monthlyInterest: number
  payment: number
}

function debtLines({ cards, debts, inbox, today }: DiagnosisInput) {
  const lines: DebtLine[] = []
  for (const c of cards) {
    const balance = Math.max(0, c.totalDebt - cardPaid(c, inbox).paid)
    if (balance < 1_000) continue
    const monthlyInterest = balance * (Math.pow(1 + c.ea, 1 / 12) - 1)
    lines.push({ name: `${c.kind === 'prestamo' ? 'Crédito' : 'Tarjeta'} ${c.bank} *${c.last4}`, balance, ea: c.ea, monthlyInterest, payment: c.minPayment })
  }
  for (const d of debts) {
    if (d.direction !== 'debo') continue
    const { balance } = simulateDebt(d, today)
    if (balance < 1_000) continue
    const ea = [...d.rates].sort((a, b) => a.from.localeCompare(b.from)).pop()?.ea ?? 0
    lines.push({ name: `Deuda con ${d.name}`, balance, ea, monthlyInterest: payoffProjection(d, balance, today).monthlyInterest, payment: d.installment })
  }
  return lines.sort((a, b) => b.ea - a.ea)
}

function dataFindings(input: DiagnosisInput, months: string[]): Finding[] {
  const out: Finding[] = []
  const pending = input.inbox.filter((i) => i.status === 'pendiente' && i.role === 'movimiento' && !i.deleted).length
  if (pending) {
    out.push({
      id: 'pendientes', tone: 'atencion', area: 'Tus datos', go: 'revisar',
      title: `${plural(pending, 'movimiento')} sin revisar`,
      detail: 'No cuentan en este diagnóstico hasta que los aceptes en Revisar.',
    })
  }
  const stale = input.cards.filter((c) => c.totalDebt >= 1_000 && daysBetween(c.cutDate, input.today) > 45)
  if (stale.length) {
    out.push({
      id: 'extractos-viejos', tone: 'atencion', area: 'Tus datos', go: 'deudas',
      title: `${plural(stale.length, 'extracto')} desactualizado${stale.length > 1 ? 's' : ''}`,
      detail: 'Los saldos y los intereses de estas tarjetas salen de un corte de hace más de 45 días. Carga el extracto más reciente.',
      items: stale.map((c) => ({ label: `${c.bank} *${c.last4}`, value: `corte del ${shortDate(c.cutDate)}` })),
    })
  }
  if (months.length < 3) {
    out.push({
      id: 'pocos-meses', tone: 'info', area: 'Tus datos',
      title: months.length ? `Solo hay ${plural(months.length, 'mes completo', 'meses completos')}` : 'Todavía no hay un mes completo',
      detail: 'Con al menos 3 meses terminados, los promedios y las comparaciones son más confiables.',
    })
  }
  return out
}

function balanceFindings(input: DiagnosisInput, months: string[]): Finding[] {
  if (!months.length) return []
  const stats = months.map((m) => ({ month: m, ...monthStats(realIncome(input.movements.filter((x) => x.date.startsWith(m)))) }))
  const last = stats[stats.length - 1]
  const avgIncome = avg(stats.map((s) => s.income))
  const avgExpenses = avg(stats.map((s) => s.expenses))
  const negative = stats.filter((s) => s.remaining < 0)
  const out: Finding[] = []
  const items = stats.map((s) => ({ label: `${monthLabel(s.month)}: te quedó`, value: money(s.remaining) }))

  if (last.remaining < 0 || negative.length > stats.length / 2) {
    out.push({
      id: 'balance', tone: 'alerta', area: 'Ingresos y gastos', items, go: 'movimientos',
      title: negative.length === stats.length ? 'Gastaste más de lo que entró todos los meses' : `Gastaste más de lo que entró en ${negative.length} de ${plural(stats.length, 'mes', 'meses')}`,
      detail: `En promedio entran ${money(avgIncome)} y salen ${money(avgExpenses)} al mes. La diferencia sale de tus ahorros o de deuda.`,
    })
  } else {
    const share = last.income ? last.remaining / last.income : 0
    out.push({
      id: 'balance', tone: share >= 0.1 ? 'bien' : 'info', area: 'Ingresos y gastos', items,
      title: `En ${monthName(last.month)} te quedó el ${pct(share)} de lo que entró`,
      detail: `En promedio entran ${money(avgIncome)} y salen ${money(avgExpenses)} al mes.`,
    })
  }

  // El ingreso de quien cobra por trabajo sube y baja: ¿el mes malo alcanza?
  const lowest = stats.reduce((a, b) => (b.income < a.income ? b : a), stats[0])
  if (stats.length >= 2 && lowest.income < avgExpenses) {
    out.push({
      id: 'mes-bajo', tone: 'atencion', area: 'Ingresos y gastos',
      title: 'Tu mes más bajo no alcanza para tu gasto promedio',
      detail: `En ${monthName(lowest.month)} entraron ${money(lowest.income)} y tu gasto promedio es ${money(avgExpenses)}. Faltarían ${money(avgExpenses - lowest.income)} en un mes así.`,
    })
  }
  return out
}

function debtFindings(input: DiagnosisInput, lines: DebtLine[], avgIncome: number): Finding[] {
  const { cards, debts, inbox, today } = input
  const out: Finding[] = []
  const days = (d: string) => daysBetween(today, d)
  const unpaid = cards.filter((c) => c.totalDebt >= 1_000 && c.dueDate && !cardPaid(c, inbox).covered)
  const name = (c: CardRecord) => `${c.kind === 'prestamo' ? 'Crédito' : 'Tarjeta'} ${c.bank} *${c.last4}`

  const late = [
    ...unpaid.filter((c) => days(c.dueDate) < 0).map((c) => ({ label: name(c), value: `${money(c.minPayment)} · venció el ${shortDate(c.dueDate)}` })),
    ...debts.filter((d) => d.direction === 'debo').flatMap((d) => {
      const { overdue } = overdueInstallments(d, today)
      return overdue.length ? [{ label: `Deuda con ${d.name}`, value: plural(overdue.length, 'cuota') }] : []
    }),
  ]
  if (late.length) {
    out.push({
      id: 'atrasos', tone: 'alerta', area: 'Deudas', go: 'deudas', items: late,
      title: `${plural(late.length, 'pago vencido', 'pagos vencidos')}`,
      detail: 'Un atraso puede sumar intereses de mora y reportes. Si ya pagaste y no aparece, márcalo con "Ya pagué" o carga el extracto.',
    })
  }
  const soon = unpaid.filter((c) => days(c.dueDate) >= 0 && days(c.dueDate) <= 7)
  if (soon.length) {
    out.push({
      id: 'por-vencer', tone: 'atencion', area: 'Deudas', go: 'deudas',
      title: `${plural(soon.length, 'pago vence', 'pagos vencen')} esta semana`,
      detail: 'Según el último extracto, y sin un pago registrado después del corte.',
      items: soon.map((c) => ({ label: name(c), value: `${money(c.minPayment)} · ${shortDate(c.dueDate)}` })),
    })
  }

  const withRate = lines.filter((l) => l.ea > 0)
  const interest = lines.reduce((s, l) => s + l.monthlyInterest, 0)
  if (withRate.length) {
    const top = withRate[0]
    out.push({
      id: 'intereses', tone: avgIncome && interest / avgIncome >= 0.1 ? 'atencion' : 'info', area: 'Deudas', go: 'deudas',
      title: `Tus deudas cuestan cerca de ${money(interest)} al mes en intereses`,
      detail: `La de tasa más alta es ${top.name} (${rate(top.ea)}). Cada $100.000 que abones ahí dejan de costarte unos ${money(100_000 * (Math.pow(1 + top.ea, 1 / 12) - 1))} al mes. Es un cálculo aproximado con la tasa más alta de cada extracto.`,
      items: withRate.map((l) => ({ label: l.name, value: `${money(l.balance)} · ${rate(l.ea)} · ${money(l.monthlyInterest)}/mes` })),
    })
  }

  const trapped = lines.filter((l) => l.payment > 0 && l.monthlyInterest / l.payment >= 0.5 && l.name.startsWith('Tarjeta'))
  if (trapped.length) {
    out.push({
      id: 'minimo', tone: 'atencion', area: 'Deudas', go: 'deudas',
      title: 'Con el pago mínimo la deuda baja muy despacio',
      detail: 'Más de la mitad del mínimo se iría en intereses. Lo que pagues por encima del mínimo baja directamente el saldo.',
      items: trapped.map((l) => ({ label: l.name, value: `${pct(l.monthlyInterest / l.payment)} de ${money(l.payment)}` })),
    })
  }

  const used = cards.filter((c) => c.kind !== 'prestamo' && c.limit > 0 && c.totalDebt / c.limit >= 0.7)
  if (used.length) {
    out.push({
      id: 'cupo', tone: 'atencion', area: 'Deudas', go: 'deudas',
      title: `${plural(used.length, 'tarjeta')} con el cupo casi lleno`,
      detail: 'Usaste el 70 % o más del cupo.',
      items: used.map((c) => ({ label: name(c), value: `${pct(c.totalDebt / c.limit)} de ${money(c.limit)}` })),
    })
  }

  const payments = lines.reduce((s, l) => s + l.payment, 0)
  if (payments && avgIncome) {
    const share = payments / avgIncome
    if (share >= 0.2) {
      out.push({
        id: 'carga', tone: share >= 0.4 ? 'alerta' : 'atencion', area: 'Deudas', go: 'deudas',
        title: `Los pagos de deuda se llevan el ${pct(share)} de tu ingreso`,
        detail: `Mínimos y cuotas suman ${money(payments)} al mes, y tu ingreso promedio es ${money(avgIncome)}.`,
      })
    }
  }
  if (lines.length && !late.length) {
    out.push({ id: 'al-dia', tone: 'bien', area: 'Deudas', title: 'Vas al día con tus deudas', detail: 'No hay pagos vencidos según tus extractos y tus alertas.' })
  }
  return out
}

function collectionFindings(input: DiagnosisInput, avgIncome: number): Finding[] {
  const { receivables, inbox, today, debts } = input
  const pending = receivables.filter((r) => !r.paid)
  const out: Finding[] = []
  const total = pending.reduce((s, r) => s + r.amount, 0)
  const age = (r: Receivable) => daysBetween(r.sentDate, today)

  const proposals = proposedPayments(pending, inbox)
  if (proposals.size) {
    out.push({
      id: 'pago-propuesto', tone: 'info', area: 'Por cobrar', go: 'deudas',
      title: 'Parece que ya te pagaron',
      detail: `Hay ${plural(proposals.size, 'ingreso')} que coincide${proposals.size > 1 ? 'n' : ''} con tus cuentas de cobro. Confírmalo en Deudas.`,
    })
  }
  const late = pending.filter((r) => (r.dueDate ? r.dueDate < today : age(r) > 30))
  if (late.length) {
    out.push({
      id: 'cobros-atrasados', tone: 'atencion', area: 'Por cobrar', go: 'deudas',
      title: `${plural(late.length, 'cobro atrasado', 'cobros atrasados')}: ${money(late.reduce((s, r) => s + r.amount, 0))}`,
      detail: 'Ya pasó la fecha acordada o llevan más de 30 días sin una fecha de pago.',
      items: late.map((r) => ({ label: r.client, value: `${money(r.amount)} · hace ${plural(age(r), 'día')}` })),
    })
  }
  if (total) {
    const noDate = pending.filter((r) => !r.dueDate).length
    out.push({
      id: 'por-cobrar', tone: 'info', area: 'Por cobrar', go: 'deudas',
      title: `Tienes ${money(total)} por cobrar`,
      detail: `${avgIncome ? `Equivale a ${(total / avgIncome).toFixed(1).replace('.', ',')} meses de tu ingreso promedio. ` : ''}Todavía no es plata disponible.${noDate ? ` ${plural(noDate, 'cobro')} sin fecha de pago: agrégala para que la app avise si se atrasa.` : ''}`,
    })
  }

  const paid = receivables.filter((r) => r.paid)
  const year = today.slice(0, 4)
  const withheld = paid.filter((r) => r.paid!.date.startsWith(year)).reduce((s, r) => s + Math.max(0, r.amount - r.paid!.amount), 0)
  if (paid.length >= 2 || withheld > 0) {
    const days = Math.round(avg(paid.map((r) => daysBetween(r.sentDate, r.paid!.date))))
    out.push({
      id: 'historial-cobros', tone: 'info', area: 'Por cobrar',
      title: `Te pagan en unos ${plural(days, 'día')}`,
      detail: `Promedio de ${plural(paid.length, 'cobro pagado', 'cobros pagados')}.${withheld > 0 ? ` Este año te han pagado ${money(withheld)} menos de lo cobrado, posiblemente por retención: pide los certificados para la declaración de renta.` : ''}`,
    })
  }

  const owed = debts.filter((d) => d.direction === 'me-deben' && overdueInstallments(d, today).overdue.length)
  if (owed.length) {
    out.push({
      id: 'prestamos-atrasados', tone: 'atencion', area: 'Por cobrar', go: 'deudas',
      title: `${plural(owed.length, 'préstamo tuyo atrasado', 'préstamos tuyos atrasados')}`,
      detail: 'Te deben cuotas vencidas.',
      items: owed.map((d) => ({ label: d.name, value: plural(overdueInstallments(d, today).overdue.length, 'cuota') })),
    })
  }
  return out
}

function spendingFindings(input: DiagnosisInput, months: string[]): Finding[] {
  if (!months.length) return []
  const out: Finding[] = []
  const inMonth = (m: string) => input.movements.filter((x) => x.date.startsWith(m))
  const lastMonth = months[months.length - 1]
  const last = inMonth(lastMonth)
  const s = monthStats(realIncome(last))
  const expenses = last.filter((m) => m.kind === 'gasto')

  // Si está en Otros, las comparaciones por categoría no sirven.
  const others = expenses.filter((m) => m.category === 'Otros')
  const othersTotal = others.reduce((a, m) => a + m.amount, 0)
  if (s.expenses && othersTotal / s.expenses >= 0.2) {
    out.push({
      id: 'otros', tone: 'atencion', area: 'Gastos', go: 'movimientos',
      title: `El ${pct(othersTotal / s.expenses)} de tus gastos está en "Otros"`,
      detail: `Son ${money(othersTotal)} en ${monthName(lastMonth)} sin saber en qué se fueron. Estos son los más grandes; al categorizarlos, el análisis mejora.`,
      items: topByMerchant(others, 5).map((t) => ({ label: t.label, value: money(t.total) })),
    })
  }

  // Compra y pago de la misma tarjeta: los dos quedan como gasto.
  const cardPayments = expenses.filter((m) => m.subcategory === 'Tarjeta de crédito' || /^compa[nñ][ií]a de\b/i.test(m.description))
  const cardPaymentsTotal = cardPayments.reduce((a, m) => a + m.amount, 0)
  if (cardPaymentsTotal >= 50_000) {
    out.push({
      id: 'pagos-tarjeta', tone: 'info', area: 'Gastos', go: 'movimientos',
      title: 'Tu gasto puede verse más alto de lo real',
      detail: `En ${monthName(lastMonth)} hay ${money(cardPaymentsTotal)} que parecen pagos a tarjetas o créditos. Si esas compras también están anotadas, la misma plata cuenta dos veces, igual que en Resumen.`,
      items: cardPayments.slice(0, 5).map((m) => ({ label: m.description, value: money(m.amount) })),
    })
  }

  const prior = months.slice(0, -1)
  if (prior.length >= 2) {
    const priorStats = prior.map((m) => monthStats(inMonth(m)))
    const rises = s.byCategory
      .filter((c) => c.name !== 'Otros' && c.name !== 'Deudas')
      .map((c) => ({ ...c, before: avg(priorStats.map((p) => p.byCategory.find((x) => x.name === c.name)?.total ?? 0)) }))
      .filter((c) => c.total >= c.before * 1.3 && c.total - c.before >= 100_000)
      .sort((a, b) => b.total - b.before - (a.total - a.before))
    if (rises.length) {
      out.push({
        id: 'subidas', tone: 'atencion', area: 'Gastos', go: 'movimientos',
        title: `${plural(rises.length, 'categoría subió', 'categorías subieron')} en ${monthName(lastMonth)}`,
        detail: `Comparado con tu promedio de los ${prior.length} meses anteriores.`,
        items: rises.map((c) => ({ label: c.name, value: `${money(c.before)} → ${money(c.total)}` })),
      })
    }
  }

  const repeated = repeatedCharges(input.movements, input.today)
  if (repeated.length) {
    const total = repeated.reduce((a, r) => a + r.amount, 0)
    out.push({
      id: 'repetidos', tone: 'info', area: 'Gastos', go: 'movimientos',
      title: `${plural(repeated.length, 'cobro se repite', 'cobros se repiten')} cada mes: ${money(total)}`,
      detail: `Son ${money(total * 12)} al año. Revisa si todos te siguen sirviendo.`,
      items: repeated.slice(0, 8).map((r) => ({ label: r.name, value: money(r.amount) })),
    })
  }

  if (s.ant.total >= 100_000 || (s.income && s.ant.total / s.income >= 0.05)) {
    const small = expenses.filter((m) => m.recurrence === 'ocasional' && m.amount <= ANT_EXPENSE_LIMIT)
    out.push({
      id: 'hormiga', tone: 'info', area: 'Gastos', go: 'movimientos',
      title: `Gastos hormiga: ${money(s.ant.total)} en ${monthName(lastMonth)}`,
      detail: `${plural(s.ant.count, 'gasto')} de hasta ${money(ANT_EXPENSE_LIMIT)}${s.income ? `, el ${pct(s.ant.total / s.income)} de lo que entró` : ''}. A este ritmo son ${money(s.ant.total * 12)} al año.`,
      items: topByMerchant(small, 3).map((t) => ({ label: t.label, value: `${t.count} × · ${money(t.total)}` })),
    })
  }
  return out
}

function budgetFindings(input: DiagnosisInput): Finding[] {
  const month = input.today.slice(0, 7)
  if (!input.budgets.length) {
    return [{
      id: 'sin-presupuesto', tone: 'info', area: 'Presupuesto', go: 'presupuesto',
      title: `No tienes presupuesto para ${monthName(month)}`,
      detail: 'Con un tope por categoría, la app te avisa cuando vas muy rápido, antes de que se acabe el mes.',
    }]
  }
  const spent = monthStats(input.movements.filter((m) => m.date.startsWith(month))).byCategory
  const day = Number(input.today.slice(8))
  const expected = day / daysInMonth(month)
  const rows = input.budgets.map((b) => ({ ...b, spent: spent.find((c) => c.name === b.category)?.total ?? 0 }))
  const over = rows.filter((r) => r.spent > r.amount)
  const fast = day >= 5 ? rows.filter((r) => r.spent <= r.amount && r.spent / r.amount > expected * 1.25) : []
  if (!over.length && !fast.length) {
    return [{ id: 'presupuesto', tone: 'bien', area: 'Presupuesto', title: 'Tu presupuesto va bien', detail: `Ninguna categoría va por encima de lo esperado para el día ${day}.` }]
  }
  return [{
    id: 'presupuesto', tone: over.length ? 'alerta' : 'atencion', area: 'Presupuesto', go: 'presupuesto',
    title: over.length ? `${plural(over.length, 'categoría pasada', 'categorías pasadas')} del presupuesto` : `${plural(fast.length, 'categoría va', 'categorías van')} muy rápido`,
    detail: `Vas en el ${pct(expected)} del mes.`,
    items: [...over, ...fast].map((r) => ({ label: r.category, value: `${money(r.spent)} de ${money(r.amount)}` })),
  }]
}

export function diagnose(input: DiagnosisInput): Diagnosis {
  const months = completeMonths(input.movements, input.today)
  const stats = months.map((m) => monthStats(realIncome(input.movements.filter((x) => x.date.startsWith(m)))))
  const avgIncome = avg(stats.map((s) => s.income))
  const lines = debtLines(input)
  const findings = [
    ...debtFindings(input, lines, avgIncome),
    ...balanceFindings(input, months),
    ...collectionFindings(input, avgIncome),
    ...budgetFindings(input),
    ...spendingFindings(input, months),
    ...dataFindings(input, months),
  ].sort((a, b) => TONE_ORDER.indexOf(a.tone) - TONE_ORDER.indexOf(b.tone))
  return {
    months,
    avgIncome,
    avgExpenses: avg(stats.map((s) => s.expenses)),
    monthlyInterest: lines.reduce((s, l) => s + l.monthlyInterest, 0),
    monthlyDebtPayments: lines.reduce((s, l) => s + l.payment, 0),
    toCollect: input.receivables.filter((r) => !r.paid).reduce((s, r) => s + r.amount, 0),
    findings,
  }
}

// Cuántos meses de historia se piden para el diagnóstico (el actual y los anteriores).
export function diagnosisStart(month = currentMonth()) {
  return `${shiftMonth(month, -MAX_MONTHS)}-01`
}
