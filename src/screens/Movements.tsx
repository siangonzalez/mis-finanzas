import { useState } from 'react'
import { findCategory } from '../data/categories'
import type { Movement } from '../data/db'
import { dayLabel, money } from '../lib/format'

type Filter = 'todos' | 'gasto' | 'ingreso'

interface Props {
  movements: Movement[]
  onEdit: (m: Movement) => void
}

export function Movements({ movements, onEdit }: Props) {
  const [filter, setFilter] = useState<Filter>('todos')
  const [query, setQuery] = useState('')

  const q = query.trim().toLowerCase()
  const visible = movements
    .filter((m) => filter === 'todos' || m.kind === filter)
    .filter((m) => !q || `${m.description} ${m.category} ${m.subcategory}`.toLowerCase().includes(q))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)

  const byDay = new Map<string, Movement[]>()
  for (const m of visible) byDay.set(m.date, [...(byDay.get(m.date) ?? []), m])

  return (
    <>
      <div className="segmented">
        {(['todos', 'gasto', 'ingreso'] as Filter[]).map((f) => (
          <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
            {f === 'todos' ? 'Todos' : f === 'gasto' ? 'Gastos' : 'Ingresos'}
          </button>
        ))}
      </div>
      <input className="search" placeholder="Buscar…" value={query} onChange={(e) => setQuery(e.target.value)} />

      {visible.length === 0 && <p className="muted center">No hay movimientos para mostrar.</p>}

      {[...byDay].map(([day, list]) => (
        <section key={day} className="day">
          <h4>{dayLabel(day)}</h4>
          <ul className="card movement-list">
            {list.map((m) => {
              const cat = findCategory(m.kind, m.category)
              return (
                <li key={m.id}>
                  <button onClick={() => onEdit(m)}>
                    <span className="mv-icon" style={{ background: `${cat.color}22` }}>{cat.emoji}</span>
                    <span className="mv-text">
                      <b>{m.description}</b>
                      <span className="muted small">
                        {m.category}
                        {m.subcategory !== m.category && ` · ${m.subcategory}`}
                        {m.recurrence === 'fijo' && ' · fijo'}
                      </span>
                    </span>
                    <b className={m.kind === 'ingreso' ? 'pos' : ''}>
                      {m.kind === 'ingreso' ? '+' : '−'}{money(m.amount)}
                    </b>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </>
  )
}
