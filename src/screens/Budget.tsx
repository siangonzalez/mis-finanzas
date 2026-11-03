import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { EXPENSE_CATEGORIES } from '../data/categories'
import { budgetsInMonth, copyBudgets, saveBudget, type Movement } from '../data/db'
import { money, moneyInput, parseMoney, shiftMonth } from '../lib/format'
import { monthStats } from '../lib/stats'

interface Props {
  month: string
  movements: Movement[]
}

export function Budget({ month, movements }: Props) {
  const budgets = useLiveQuery(() => budgetsInMonth(month), [month]) ?? []
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState(0)

  const spent = new Map(monthStats(movements).byCategory.map((c) => [c.name, c.total]))
  const planned = new Map(budgets.map((b) => [b.category, b.amount]))
  const totalPlanned = budgets.reduce((a, b) => a + b.amount, 0)
  const totalSpent = [...spent.values()].reduce((a, b) => a + b, 0)

  const start = (category: string) => {
    setEditing(category)
    setDraft(planned.get(category) ?? 0)
  }

  const commit = async () => {
    if (editing) await saveBudget(month, editing, draft)
    setEditing(null)
  }

  const copyPrevious = async () => {
    const n = await copyBudgets(shiftMonth(month, -1), month)
    if (n === 0) alert('El mes anterior no tiene presupuesto.')
  }

  return (
    <>
      <section className="card hero">
        <p className="muted">Presupuesto del mes</p>
        <p className="hero-amount">{money(totalPlanned)}</p>
        <p className="muted small">
          {totalPlanned === 0
            ? 'Define cuánto quieres gastar en cada categoría.'
            : `Llevas ${money(totalSpent)} gastado · ${totalSpent > totalPlanned ? 'te pasaste por' : 'te quedan'} ${money(Math.abs(totalPlanned - totalSpent))}`}
        </p>
        {budgets.length === 0 && (
          <button className="ghost" onClick={copyPrevious}>Copiar del mes anterior</button>
        )}
      </section>

      <ul className="card budget-list">
        {EXPENSE_CATEGORIES.map((c) => {
          const plan = planned.get(c.name) ?? 0
          const used = spent.get(c.name) ?? 0
          const pct = plan ? used / plan : 0
          const tone = !plan ? '' : pct > 1 ? 'over' : pct > 0.8 ? 'warn' : 'ok'
          return (
            <li key={c.name}>
              <div className="bar-label">
                <span>{c.emoji} {c.name}</span>
                {editing === c.name ? (
                  <input
                    className="budget-input"
                    inputMode="numeric"
                    autoFocus
                    value={moneyInput(draft)}
                    onChange={(e) => setDraft(parseMoney(e.target.value))}
                    onBlur={commit}
                    onKeyDown={(e) => e.key === 'Enter' && commit()}
                  />
                ) : (
                  <button className="link" onClick={() => start(c.name)}>
                    {plan ? `${money(used)} / ${money(plan)}` : used ? `${money(used)} · definir` : 'Definir'}
                  </button>
                )}
              </div>
              {plan > 0 && (
                <div className="bar-track">
                  <div className={`bar-fill ${tone}`} style={{ width: `${Math.min(100, pct * 100)}%` }} />
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </>
  )
}
