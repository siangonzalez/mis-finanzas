import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { addDebtPayment, db, getSetting, importDebtFile, saveMovement, type Debt } from '../data/db'
import { syncDebts, type SyncResult } from '../data/debtSync'
import { overdueInstallments, payoffProjection, simulateDebt } from '../lib/debt'
import { money, moneyInput, monthLabel, parseMoney, todayISO } from '../lib/format'

function shortDate(d: string) {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function Debts() {
  const debts = useLiveQuery(() => db.debts.toArray(), [])
  const fileRef = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState('')
  const [sync, setSync] = useState<SyncResult | null>(null)
  const [syncing, setSyncing] = useState(false)
  const sheetUrl = useLiveQuery(() => getSetting('debts.sheetUrl'), [])

  const runSync = async () => {
    setSyncing(true)
    setSync(await syncDebts())
    setSyncing(false)
  }

  useEffect(() => {
    void runSync()
  }, [])

  const importFile = async (file: File) => {
    try {
      const d = await importDebtFile(JSON.parse(await file.text()))
      setMessage(`Deuda con ${d.name} cargada.`)
      void runSync()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'No se pudo leer el archivo.')
    }
  }

  if (debts === undefined) return null

  return (
    <>
      {debts.length === 0 && (
        <section className="empty">
          <p className="big-emoji">🤝</p>
          <h2>Tus deudas, claras</h2>
          <p>Carga el archivo de la deuda (por ejemplo, <code>deuda-juan-camilo.json</code>) para ver el saldo con intereses, las cuotas pendientes y cuándo terminas.</p>
        </section>
      )}

      <div className={`sync-line ${sync && !sync.ok ? 'bad' : ''}`}>
        <span>{syncing ? 'Sincronizando con Google…' : sync?.message ?? ''}</span>
        <span>
          {sheetUrl && <a className="link" href={sheetUrl} target="_blank" rel="noopener">Ver hoja</a>}
          <button className="link" disabled={syncing} onClick={runSync}>↻</button>
        </span>
      </div>

      {debts.map((d) => <DebtView key={d.id} debt={d} onChange={runSync} />)}

      <section className="card">
        <button className="ghost" onClick={() => fileRef.current?.click()}>
          {debts.length ? 'Cargar otra deuda o actualizar' : 'Cargar archivo de deuda'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) importFile(f)
            e.target.value = ''
          }}
        />
        {message && <p className="pill">{message}</p>}
      </section>
    </>
  )
}

function DebtView({ debt, onChange }: { debt: Debt; onChange: () => void }) {
  const today = todayISO()
  const sim = simulateDebt(debt, today)
  const { overdue, next } = overdueInstallments(debt, today)
  const [whatIf, setWhatIf] = useState(debt.installment)
  const plan = payoffProjection({ ...debt, installment: whatIf }, sim.balance, today)
  const currentEA = [...debt.rates].sort((a, b) => a.from.localeCompare(b.from)).filter((r) => r.from <= today).pop()?.ea ?? 0
  const lastPayment = debt.payments.map((p) => p.date).sort().pop()
  const [showForm, setShowForm] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const rows = [...sim.rows].reverse()

  return (
    <>
      <section className="card hero">
        <p className="muted">{debt.direction === 'debo' ? `Le debes a ${debt.name}` : `${debt.name} te debe`}</p>
        <p className="hero-amount">{money(sim.balance)}</p>
        <p className="muted small">Capital + intereses − pagos · hoy al {(currentEA * 100).toFixed(0)} % EA</p>
      </section>

      {overdue.length > 0 && (
        <section className="card alert">
          <b>⚠️ {overdue.length === 1 ? 'Cuota pendiente' : `${overdue.length} cuotas pendientes`}: {overdue.map((d) => monthLabel(d.slice(0, 7)).toLowerCase()).join(' y ')}</b>
          <p className="small">
            Para ponerte al día: {money(debt.installment * overdue.length)}. Desde el último pago ({lastPayment ? shortDate(lastPayment) : '—'}) van {money(sim.interestSinceLastEvent)} de intereses.
          </p>
        </section>
      )}

      <section className="grid2">
        <div className="card stat">
          <span className="muted small">Total prestado</span>
          <b>{money(sim.disbursed)}</b>
        </div>
        <div className="card stat">
          <span className="muted small">Intereses causados</span>
          <b className="warn-text">{money(sim.interestTotal)}</b>
        </div>
        <div className="card stat">
          <span className="muted small">Total pagado</span>
          <b className="pos">{money(sim.paid)}</b>
        </div>
        <div className="card stat">
          <span className="muted small">Próxima cuota</span>
          <b className={overdue.length ? 'neg' : ''}>{money(debt.installment * (overdue.length + 1))}</b>
          <span className="muted small">{next ? shortDate(next) : '—'}{overdue.length ? ' (incluye vencidas)' : ''}</span>
        </div>
      </section>

      <section className="card">
        <h3>Cómo ha ido el saldo</h3>
        <BalanceChart series={sim.series} />
      </section>

      <section className="card">
        <h3>¿Cuándo terminas?</h3>
        <p className="muted small">
          Cada mes la deuda genera unos <b className="warn-text">{money(plan.monthlyInterest)}</b> de interés. Lo que pagues por encima de eso baja el capital.
        </p>
        <label className="whatif">
          <span>Si pagas al mes</span>
          <input inputMode="numeric" value={moneyInput(whatIf)} onChange={(e) => setWhatIf(parseMoney(e.target.value))} />
        </label>
        <p className="pill">
          {plan.months === Infinity
            ? 'Con esa cuota no alcanzas a cubrir los intereses: la deuda seguiría creciendo.'
            : `Terminarías en ${monthLabel(plan.endMonth).toLowerCase()} · ${plan.months} cuotas`}
        </p>
      </section>

      <section className="card">
        <div className="inbox-head">
          <h3>Movimientos</h3>
          <button className="link" onClick={() => setShowForm(!showForm)}>{showForm ? 'Cancelar' : '+ Registrar pago'}</button>
        </div>
        {showForm && (
          <PaymentForm
            debt={debt}
            onDone={() => {
              setShowForm(false)
              onChange()
            }}
          />
        )}
        <ul className="list-plain debt-rows">
          {(showAll ? rows : rows.slice(0, 8)).map((r, i) => (
            <li key={`${r.date}-${i}`}>
              <span>
                <b className={r.type === 'prestamo' ? 'warn-text' : 'pos'}>
                  {r.type === 'prestamo' ? '▲ ' : '✓ '}
                  {r.type === 'prestamo' ? r.note || 'Préstamo' : 'Pago'}
                </b>
                {r.pending && <span className="muted small"> · sin subir</span>}
                <span className="muted small"> · {shortDate(r.date)}{r.type === 'pago' && r.note ? ` · ${r.note}` : ''}</span>
                {r.interestSincePrevious > 0 && <span className="muted small"> · +{money(r.interestSincePrevious)} interés</span>}
              </span>
              <span className="debt-amount">
                {r.type === 'prestamo' ? '+' : '−'}{money(r.amount)}
                <span className="muted small">{money(r.balanceAfter)}</span>
              </span>
            </li>
          ))}
        </ul>
        {rows.length > 8 && (
          <button className="link" onClick={() => setShowAll(!showAll)}>{showAll ? 'Ver menos' : `Ver los ${rows.length} movimientos`}</button>
        )}
      </section>
    </>
  )
}

function PaymentForm({ debt, onDone }: { debt: Debt; onDone: () => void }) {
  const [date, setDate] = useState(todayISO())
  const [amount, setAmount] = useState(debt.installment)
  const [note, setNote] = useState('')
  const [asExpense, setAsExpense] = useState(true)

  const save = async () => {
    if (!amount) return
    await addDebtPayment(debt.id, { date, amount, note: note.trim(), source: 'app' })
    if (asExpense) {
      await saveMovement({
        date, kind: debt.direction === 'debo' ? 'gasto' : 'ingreso',
        category: debt.direction === 'debo' ? 'Deudas' : 'Otros', subcategory: 'Otros',
        description: `Pago deuda ${debt.name}`, amount, recurrence: 'fijo', source: 'manual', createdAt: Date.now(),
      })
    }
    onDone()
  }

  return (
    <div className="sheet debt-form">
      <div className="row">
        <label>
          <span>Fecha</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          <span>Valor</span>
          <input inputMode="numeric" value={moneyInput(amount)} onChange={(e) => setAmount(parseMoney(e.target.value))} />
        </label>
      </div>
      <label>
        <span>Nota</span>
        <input placeholder="Ej: cuota de septiembre" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <label className="check">
        <input type="checkbox" checked={asExpense} onChange={(e) => setAsExpense(e.target.checked)} />
        <span>Anotarlo también en mis gastos del mes</span>
      </label>
      <button className="primary" disabled={!amount} onClick={save}>Guardar pago</button>
    </div>
  )
}

function BalanceChart({ series }: { series: { date: string; balance: number }[] }) {
  if (series.length < 2) return null
  const W = 340, H = 150, pad = { t: 10, r: 8, b: 20, l: 8 }
  const t0 = Date.parse(series[0].date), t1 = Date.parse(series[series.length - 1].date)
  const max = Math.max(...series.map((p) => p.balance)) * 1.08
  const x = (d: string) => pad.l + ((Date.parse(d) - t0) / (t1 - t0 || 1)) * (W - pad.l - pad.r)
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b)
  const line = series.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.balance).toFixed(1)}`).join('')
  const area = `${line}L${x(series[series.length - 1].date)},${y(0)}L${x(series[0].date)},${y(0)}Z`
  const years = [...new Set(series.map((p) => p.date.slice(0, 4)))].slice(1)
  const last = series[series.length - 1]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Saldo de la deuda en el tiempo">
      <defs>
        <linearGradient id="debt-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--accent)" stopOpacity="0.35" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {years.map((yr) => (
        <g key={yr}>
          <line x1={x(`${yr}-01-01`)} x2={x(`${yr}-01-01`)} y1={pad.t} y2={H - pad.b} stroke="var(--line)" strokeDasharray="3 4" />
          <text x={x(`${yr}-01-01`)} y={H - 6} fill="var(--muted)" fontSize="10" textAnchor="middle">{yr}</text>
        </g>
      ))}
      <path d={area} fill="url(#debt-fill)" />
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />
      <circle cx={x(last.date)} cy={y(last.balance)} r="4" fill="var(--accent)" />
    </svg>
  )
}
