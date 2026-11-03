import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../data/db'
import { overdueInstallments, simulateDebt } from '../lib/debt'
import { money, todayISO } from '../lib/format'

// Tarjeta corta en el Resumen para no perder de vista las deudas.
export function DebtReminder({ onOpen }: { onOpen: () => void }) {
  const debts = useLiveQuery(() => db.debts.toArray(), []) ?? []
  if (!debts.length) return null
  const today = todayISO()

  return (
    <>
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
    </>
  )
}
