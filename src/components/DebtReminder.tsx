import { useLiveQuery } from 'dexie-react-hooks'
import { activeCards, activeReceivables, db } from '../data/db'
import { cardPaid } from '../lib/cards'
import { overdueInstallments, simulateDebt } from '../lib/debt'
import { proposedPayments, remaining } from '../lib/receivables'
import { money, todayISO } from '../lib/format'

// Tarjetas cortas en el Resumen para no perder de vista las deudas y los
// pagos de tarjeta que están por vencer (o vencidos) según el último extracto.
export function DebtReminder({ onOpen }: { onOpen: () => void }) {
  const debts = useLiveQuery(() => db.debts.toArray(), []) ?? []
  const cards = useLiveQuery(activeCards, []) ?? []
  const inbox = useLiveQuery(() => db.inbox.toArray(), []) ?? []
  const toCollect = (useLiveQuery(activeReceivables, []) ?? []).filter((r) => !r.paid)
  const today = todayISO()
  const days = (d: string) => Math.round((Date.parse(d) - Date.parse(today)) / 86_400_000)
  const dueCards = cards.filter((c) => c.totalDebt >= 1_000 && c.dueDate && days(c.dueDate) <= 7 && !cardPaid(c, inbox).covered)
  if (!debts.length && !dueCards.length && !toCollect.length) return null
  const proposals = proposedPayments(toCollect, inbox)
  const late = toCollect.filter((r) => r.dueDate && r.dueDate < today).length

  return (
    <>
      {dueCards.map((c) => {
        const d = days(c.dueDate)
        return (
          <button key={c.id} className={`card debt-reminder ${d < 0 ? 'alert' : ''}`} onClick={onOpen}>
            <span>
              <span className="muted small">{c.kind === 'prestamo' ? 'Crédito' : 'Tarjeta'} {c.bank} *{c.last4}</span>
              <b>{c.kind === 'prestamo' ? 'Cuota' : 'Mínimo'} {money(c.minPayment)}</b>
            </span>
            <span className="small">
              {d < 0 ? '⚠️ Venció, ¿ya pagaste?' : d === 0 ? '⏰ Vence hoy' : `⏰ Vence en ${d} día${d > 1 ? 's' : ''}`} ›
            </span>
          </button>
        )
      })}
      {debts.map((d) => {
        const { balance } = simulateDebt(d, today)
        const { overdue } = overdueInstallments(d, today)
        return (
          <button key={d.id} className={`card debt-reminder ${overdue.length ? 'alert' : ''}`} onClick={onOpen}>
            <span>
              <span className="muted small">{d.direction === 'debo' ? `Deuda con ${d.name}` : `${d.name} te debe`}</span>
              <b>{money(balance)}</b>
            </span>
            <span className="small">
              {overdue.length ? `⚠️ ${overdue.length} cuota${overdue.length > 1 ? 's' : ''} pendiente${overdue.length > 1 ? 's' : ''}` : 'Al día ✓'} ›
            </span>
          </button>
        )
      })}
      {toCollect.length > 0 && (
        <button className={`card debt-reminder ${late ? 'alert' : ''}`} onClick={onOpen}>
          <span>
            <span className="muted small">Por cobrar · {toCollect.length} cuenta{toCollect.length > 1 ? 's' : ''} de cobro</span>
            <b>{money(toCollect.reduce((s, r) => s + remaining(r), 0))}</b>
          </span>
          <span className="small">
            {proposals.size ? `💰 ${proposals.size === 1 ? 'Llegó un pago' : `Llegaron ${proposals.size} pagos`}, ¿es de un cobro?`
              : late ? `⚠️ ${late} vencida${late > 1 ? 's' : ''}` : 'Esperando pago'} ›
          </span>
        </button>
      )}
    </>
  )
}
