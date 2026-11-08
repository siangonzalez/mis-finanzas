import { DebtReminder } from '../components/DebtReminder'
import { DiagnosisLink } from './Diagnosis'
import { loadRealBalance, RealBalance } from '../components/RealBalance'
import { useLiveQuery } from 'dexie-react-hooks'
import { findCategory } from '../data/categories'
import type { Movement } from '../data/db'
import { currentMonth, daysInMonth, money } from '../lib/format'
import { ANT_EXPENSE_LIMIT, monthStats } from '../lib/stats'

interface Props {
  month: string
  movements: Movement[]
  onAdd: () => void
  onOpenDebts: () => void
  onOpenDiagnosis: () => void
  onOpenInbox: () => void
}

export function Summary({ month, movements, onAdd, onOpenDebts, onOpenDiagnosis, onOpenInbox }: Props) {
  const s = monthStats(movements)
  const real = useLiveQuery(loadRealBalance, [])
  const isCurrent = month === currentMonth()

  if (movements.length === 0) {
    return (
      <>
      {isCurrent && <RealBalance onReview={onOpenInbox} />}
      <DebtReminder onOpen={onOpenDebts} />
      <DiagnosisLink onOpen={onOpenDiagnosis} />
      <section className="empty">
        <p className="big-emoji">🐷</p>
        <h2>Organiza la casa</h2>
        <p>Anota tu primer ingreso o gasto de este mes. Como dice el libro: como administras lo poco, así vas a administrar lo mucho.</p>
        <button className="primary" onClick={onAdd}>Agregar movimiento</button>
      </section>
      </>
    )
  }

  const savedPct = s.income > 0 ? Math.round((s.remaining / s.income) * 100) : 0
  const day = isCurrent ? new Date().getDate() : daysInMonth(month)
  const daysLeft = daysInMonth(month) - day + 1
  // No se puede gastar más de lo que hay en las cuentas, aunque el mes vaya en positivo.
  const available = real?.date.startsWith(month) ? Math.min(s.remaining, real.now) : s.remaining
  const perDay = isCurrent && available > 0 ? available / daysLeft : 0
  const maxCat = s.byCategory[0]?.total ?? 1

  return (
    <>
      {isCurrent && <RealBalance onReview={onOpenInbox} />}

      <section className="hero card">
        <p className="muted">Balance del mes</p>
        <p className={`hero-amount ${s.remaining < 0 ? 'neg' : 'pos'}`}>{money(s.remaining)}</p>
        <p className="muted small">
          {s.income === 0
            ? 'Registra tus ingresos del mes para saber cuánto te queda.'
            : s.remaining < 0
              ? 'Estás gastando más de lo que recibiste este mes.'
              : `Te queda el ${savedPct} % de lo que recibiste.`}
          {' '}Es lo que entró menos lo que salió, no tu saldo.
        </p>
        {perDay > 0 && <p className="pill">Puedes gastar {money(perDay)} al día por {daysLeft} días</p>}
      </section>

      <DebtReminder onOpen={onOpenDebts} />
      <DiagnosisLink onOpen={onOpenDiagnosis} />

      <section className="grid2">
        <div className="card stat">
          <span className="muted small">Ingresos</span>
          <b className="pos">{money(s.income)}</b>
        </div>
        <div className="card stat">
          <span className="muted small">Gastos</span>
          <b className="neg">{money(s.expenses)}</b>
        </div>
        <div className="card stat">
          <span className="muted small">Fijos</span>
          <b>{money(s.fixed)}</b>
        </div>
        <div className="card stat">
          <span className="muted small">Ocasionales</span>
          <b>{money(s.occasional)}</b>
        </div>
      </section>

      {s.income > 0 && (
        <section className="card">
          <h3>Ingresos vs. gastos</h3>
          <div className="versus">
            <div className="versus-bar">
              <div className="versus-fill" style={{ width: `${Math.min(100, (s.expenses / s.income) * 100)}%` }} />
            </div>
            <p className="muted small">
              Gastaste {Math.round((s.expenses / s.income) * 100)} % de lo que entró.
            </p>
          </div>
        </section>
      )}

      <section className="card">
        <h3>🐜 Gastos hormiga</h3>
        <p className="muted small">Gastos ocasionales de hasta {money(ANT_EXPENSE_LIMIT)}.</p>
        <div className="ant">
          <div>
            <b>{money(s.ant.total)}</b>
            <span className="muted small">{s.ant.count} gastos este mes</span>
          </div>
          <div>
            <b>{money(s.ant.total * 12)}</b>
            <span className="muted small">al año a este ritmo</span>
          </div>
        </div>
      </section>

      {s.byCategory.length > 0 && (
        <section className="card">
          <h3>¿En qué se va la plata?</h3>
          <ul className="bars">
            {s.byCategory.map((c) => {
              const cat = findCategory('gasto', c.name)
              return (
                <li key={c.name}>
                  <div className="bar-label">
                    <span>{cat.emoji} {c.name}</span>
                    <span>{money(c.total)}</span>
                  </div>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: `${(c.total / maxCat) * 100}%`, background: cat.color }} />
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {s.incomeByCategory.length > 0 && (
        <section className="card">
          <h3>¿De dónde entra?</h3>
          <ul className="list-plain">
            {s.incomeByCategory.map((c) => (
              <li key={c.name}>
                <span>{findCategory('ingreso', c.name).emoji} {c.name}</span>
                <b>{money(c.total)}</b>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}
