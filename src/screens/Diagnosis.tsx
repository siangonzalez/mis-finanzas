import { useLiveQuery } from 'dexie-react-hooks'
import { activeCards, activeReceivables, budgetsInMonth, db, movementsSince } from '../data/db'
import { loadRealBalance } from '../components/RealBalance'
import { diagnose, diagnosisStart, type Finding, type GoTo, type Tone } from '../lib/diagnosis'
import { amountsHidden, currentMonth, money, monthLabel, todayISO } from '../lib/format'

async function loadDiagnosis() {
  return diagnose({
    today: todayISO(),
    movements: await movementsSince(diagnosisStart()),
    budgets: await budgetsInMonth(currentMonth()),
    debts: await db.debts.toArray(),
    cards: await activeCards(),
    inbox: (await db.inbox.toArray()).filter((i) => !i.deleted),
    receivables: await activeReceivables(),
    real: await loadRealBalance(),
  })
}

const TONE_LABEL: Record<Tone, string> = { alerta: 'Urgente', atencion: 'Para revisar', info: 'Para tener en cuenta', bien: 'Va bien' }
const GO_LABEL: Record<GoTo, string> = { revisar: 'Ir a Revisar', movimientos: 'Ver movimientos', presupuesto: 'Ir a Presupuesto', deudas: 'Ir a Deudas' }

// Acceso desde el Resumen, con lo que hay por mirar.
export function DiagnosisLink({ onOpen }: { onOpen: () => void }) {
  const d = useLiveQuery(loadDiagnosis, [])
  if (!d) return null
  const urgent = d.findings.filter((f) => f.tone === 'alerta').length
  const review = d.findings.filter((f) => f.tone === 'atencion').length
  return (
    <button className={`card debt-reminder ${urgent ? 'alert' : ''}`} onClick={onOpen}>
      <span>
        <span className="muted small">Diagnóstico de tus finanzas</span>
        <b>{urgent ? `${urgent} urgente${urgent > 1 ? 's' : ''}` : review ? `${review} para revisar` : 'Todo en orden'}</b>
      </span>
      <span className="small">Ver ›</span>
    </button>
  )
}

function FindingCard({ f, onGo }: { f: Finding; onGo: (tab: GoTo) => void }) {
  return (
    <li className={`card finding ${f.tone}`}>
      <span className="small muted">{f.area}</span>
      <h3>{f.title}</h3>
      <p className="small">{f.detail}</p>
      {f.items && (
        <ul className="finding-items">
          {f.items.map((i, n) => (
            <li key={n} className="small">
              <span>{i.label}</span>
              <b>{i.value}</b>
            </li>
          ))}
        </ul>
      )}
      {f.go && <button className="link" onClick={() => onGo(f.go!)}>{GO_LABEL[f.go]} ›</button>}
    </li>
  )
}

export function Diagnosis({ onGo }: { onGo: (tab: GoTo) => void }) {
  // Los textos ya traen los montos, así que se recalculan al ocultarlos o mostrarlos.
  const d = useLiveQuery(loadDiagnosis, [amountsHidden()])
  if (!d) return null
  const groups = (['alerta', 'atencion', 'info', 'bien'] as Tone[])
    .map((tone) => ({ tone, list: d.findings.filter((f) => f.tone === tone) }))
    .filter((g) => g.list.length)

  return (
    <>
      <section className="grid2">
        <div className="card stat">
          <span className="muted small">Entra al mes</span>
          <b className="pos">{money(d.avgIncome)}</b>
        </div>
        <div className="card stat">
          <span className="muted small">Sale al mes</span>
          <b className="neg">{money(d.avgExpenses)}</b>
        </div>
        <div className="card stat">
          <span className="muted small">Intereses al mes</span>
          <b>{money(d.monthlyInterest)}</b>
        </div>
        <div className="card stat">
          <span className="muted small">Por cobrar</span>
          <b>{money(d.toCollect)}</b>
        </div>
      </section>
      <p className="muted small group-note">
        {d.months.length
          ? `Promedios de ${d.months.length > 1 ? `${monthLabel(d.months[0])} a ${monthLabel(d.months[d.months.length - 1])}` : monthLabel(d.months[0])}.`
          : 'Aún no hay un mes completo para calcular promedios.'}
      </p>

      {groups.map((g) => (
        <section key={g.tone}>
          <h4 className="group-title">{TONE_LABEL[g.tone]}</h4>
          <ul className="debt-list">
            {g.list.map((f) => <FindingCard key={f.id} f={f} onGo={onGo} />)}
          </ul>
        </section>
      ))}

      <p className="muted small group-note">
        Este diagnóstico se calcula en tu dispositivo con lo que hay en la app. No conoce tus ahorros ni inversiones, solo los saldos que anotes, y no
        reemplaza a un asesor financiero. Los intereses son aproximados.
      </p>
    </>
  )
}
