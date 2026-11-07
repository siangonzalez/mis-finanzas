import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, movementsInMonth, type Movement } from './data/db'
import { handleDeepLink } from './import/deeplink'
import { startAutoSync } from './data/sync'
import { amountsHidden, currentMonth, monthLabel, setAmountsHidden, shiftMonth } from './lib/format'
import { Summary } from './screens/Summary'
import { Movements } from './screens/Movements'
import { Inbox } from './screens/Inbox'
import { Budget } from './screens/Budget'
import { Debts } from './screens/Debts'
import { Diagnosis } from './screens/Diagnosis'
import { Settings } from './screens/Settings'
import { MovementSheet } from './components/MovementSheet'

type Tab = 'resumen' | 'movimientos' | 'revisar' | 'presupuesto' | 'deudas' | 'diagnostico' | 'ajustes'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'resumen', label: 'Resumen', icon: '◎' },
  { id: 'movimientos', label: 'Movimientos', icon: '≡' },
  { id: 'revisar', label: 'Revisar', icon: '⇣' },
  { id: 'presupuesto', label: 'Presupuesto', icon: '◔' },
  { id: 'deudas', label: 'Deudas', icon: '⇄' },
]

// Sin mes en Revisar, Deudas, Diagnóstico y Ajustes: muestran todo.
const MONTHLESS: Tab[] = ['revisar', 'deudas', 'diagnostico', 'ajustes']
// Pantallas que se abren desde otra, sin botón en la barra de abajo.
const EXTRA_TABS: Tab[] = ['diagnostico', 'ajustes']

function readTab(): Tab {
  try {
    const t = localStorage.getItem('tab') as Tab | null
    return t && (EXTRA_TABS.includes(t) || TABS.some((x) => x.id === t)) ? t : 'resumen'
  } catch {
    return 'resumen'
  }
}

export default function App() {
  const [tab, setTabState] = useState<Tab>(readTab)
  const [month, setMonth] = useState(currentMonth)
  const [editing, setEditing] = useState<Movement | 'new' | null>(null)
  const movements = useLiveQuery(() => movementsInMonth(month), [month])
  const pendingCount = useLiveQuery(() => db.inbox.where('status').equals('pendiente').count(), []) ?? 0
  const [toast, setToast] = useState('')
  const [hidden, setHidden] = useState(amountsHidden)

  const setTab = (t: Tab) => {
    setTabState(t)
    try {
      localStorage.setItem('tab', t)
    } catch {
      /* sin almacenamiento: solo no recordamos la pestaña */
    }
  }

  const toggleHidden = () => {
    setAmountsHidden(!hidden)
    setHidden(!hidden)
  }

  useEffect(() => startAutoSync(), [])

  useEffect(() => {
    const run = () =>
      handleDeepLink().then((msg) => {
        if (!msg) return
        setTabState('revisar')
        setToast(msg)
        setTimeout(() => setToast(''), 3500)
      })
    run()
    window.addEventListener('hashchange', run)
    return () => window.removeEventListener('hashchange', run)
  }, [])

  return (
    <div className="app">
      <header className="topbar">
        <h1>{tab === 'ajustes' ? 'Ajustes' : tab === 'diagnostico' ? 'Diagnóstico' : 'Mis finanzas'}</h1>
        <div className="topbar-right">
          {!MONTHLESS.includes(tab) && (
            <div className="month-picker">
              <button aria-label="Mes anterior" onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
              <span>{monthLabel(month)}</span>
              <button aria-label="Mes siguiente" onClick={() => setMonth(shiftMonth(month, 1))}>›</button>
            </div>
          )}
          <button
            className={`gear ${hidden ? 'on' : ''}`}
            aria-label={hidden ? 'Mostrar montos' : 'Ocultar montos'}
            aria-pressed={hidden}
            onClick={toggleHidden}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" />
              <circle cx="12" cy="12" r="3" />
              {hidden && <path d="M4 4l16 16" />}
            </svg>
          </button>
          <button
            className={`gear ${tab === 'ajustes' ? 'on' : ''}`}
            aria-label="Ajustes"
            onClick={() => setTab(tab === 'ajustes' ? 'resumen' : 'ajustes')}
          >
            ⚙
          </button>
        </div>
      </header>

      <main className="content">
        {movements === undefined ? null : tab === 'resumen' ? (
          <Summary month={month} movements={movements} onAdd={() => setEditing('new')} onOpenDebts={() => setTab('deudas')} onOpenDiagnosis={() => setTab('diagnostico')} onOpenInbox={() => setTab('revisar')} />
        ) : tab === 'movimientos' ? (
          <Movements movements={movements} onEdit={setEditing} />
        ) : tab === 'revisar' ? (
          <Inbox onGoToSettings={() => setTab('ajustes')} />
        ) : tab === 'presupuesto' ? (
          <Budget month={month} movements={movements} />
        ) : tab === 'deudas' ? (
          <Debts />
        ) : tab === 'diagnostico' ? (
          <Diagnosis onGo={setTab} />
        ) : (
          <Settings />
        )}
      </main>

      {toast && <div className="toast">{toast}</div>}

      {!MONTHLESS.includes(tab) && (
        <button className="fab" aria-label="Agregar movimiento" onClick={() => setEditing('new')}>+</button>
      )}

      <nav className="tabbar">
        {TABS.map((t) => (
          <button key={t.id} className={t.id === tab ? 'active' : ''} onClick={() => setTab(t.id)}>
            <span className="tab-icon">
              {t.icon}
              {t.id === 'revisar' && pendingCount > 0 && <span className="badge">{pendingCount}</span>}
            </span>
            {t.label}
          </button>
        ))}
      </nav>

      {editing && (
        <MovementSheet
          movement={editing === 'new' ? null : editing}
          month={month}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
