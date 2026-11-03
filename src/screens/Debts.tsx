import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import {
  addDebtDisbursement, addDebtPayment, createDebt, db, getSetting, importDebtFile, saveMovement, type Debt,
} from '../data/db'
import { syncDebts, type SyncResult } from '../data/debtSync'
import { overdueInstallments, payoffProjection, simulateDebt } from '../lib/debt'
import { money, moneyInput, monthLabel, parseMoney, todayISO } from '../lib/format'

function shortDate(d: string) {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })
}

// Todos los textos cambian según quién le debe a quién.
function words(d: Debt) {
  const owe = d.direction === 'debo'
  return {
    owe,
    title: owe ? `Le debes a ${d.name}` : `${d.name} te debe`,
    paid: owe ? 'Has pagado' : 'Te ha pagado',
    pay: owe ? 'Registrar pago' : 'Registrar abono',
    behind: (n: number) => `${owe ? 'Tienes' : `${d.name} tiene`} ${n === 1 ? '1 cuota atrasada' : `${n} cuotas atrasadas`}`,
    when: owe ? '¿Cuándo terminas?' : '¿Cuándo te termina de pagar?',
    ifPays: owe ? 'Si pagas al mes' : 'Si te paga al mes',
    more: owe ? `${d.name} te prestó más` : `Le prestaste más a ${d.name}`,
  }
}

const SETTLED = 1_000 // menos de mil pesos cuenta como pagada

function status(d: Debt, today: string) {
  const { balance } = simulateDebt(d, today)
  const { overdue } = overdueInstallments(d, today)
  if (balance < SETTLED) return { balance, label: 'Pagada ✓', tone: 'ok' as const }
  if (overdue.length) return { balance, label: `⚠️ ${overdue.length} atrasada${overdue.length > 1 ? 's' : ''}`, tone: 'bad' as const }
  if (d.installment > 0) return { balance, label: 'Al día', tone: 'ok' as const }
  return { balance, label: 'Sin cuota fija', tone: '' as const }
}

export function Debts() {
  const debts = useLiveQuery(() => db.debts.toArray(), [])
  const fileRef = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState('')
  const [sync, setSync] = useState<SyncResult | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
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
  const today = todayISO()
  const open = debts.find((d) => d.id === openId)

  const syncLine = (
    <div className={`sync-line ${sync && !sync.ok ? 'bad' : ''}`}>
      <span>{syncing ? 'Sincronizando con Google…' : sync?.message ?? ''}</span>
      <span>
        {sheetUrl && <a className="link" href={sheetUrl} target="_blank" rel="noopener">Ver hoja</a>}
        <button className="link" disabled={syncing} onClick={runSync}>↻</button>
      </span>
    </div>
  )

  if (open) {
    return (
      <>
        <button className="link back" onClick={() => setOpenId(null)}>‹ Todas las deudas</button>
        {syncLine}
        <DebtView debt={open} onChange={runSync} />
      </>
    )
  }

  const rows = debts.map((d) => ({ d, ...status(d, today) }))
  const owed = rows.filter((r) => r.d.direction === 'me-deben').reduce((s, r) => s + Math.max(0, r.balance), 0)
  const owing = rows.filter((r) => r.d.direction === 'debo').reduce((s, r) => s + Math.max(0, r.balance), 0)

  return (
    <>
      {debts.length > 0 ? (
        <section className="grid2">
          <div className="card stat">
            <span className="muted small">Te deben</span>
            <b className="pos">{money(owed)}</b>
          </div>
          <div className="card stat">
            <span className="muted small">Debes</span>
            <b className="neg">{money(owing)}</b>
          </div>
        </section>
      ) : (
        <section className="empty">
          <p className="big-emoji">🤝</p>
          <h2>Tus deudas, claras</h2>
          <p>Anota lo que le debes a alguien o lo que alguien te debe a ti, con o sin intereses. La app calcula el saldo, las cuotas atrasadas y cuándo termina.</p>
        </section>
      )}

      {syncLine}

      {(['me-deben', 'debo'] as const).map((dir) => {
        const list = rows.filter((r) => r.d.direction === dir)
        if (!list.length) return null
        return (
          <section key={dir}>
            <h4 className="group-title">{dir === 'me-deben' ? 'Me deben' : 'Yo debo'}</h4>
            <ul className="debt-list">
              {list.map(({ d, balance, label, tone }) => (
                <li key={d.id}>
                  <button className={`card debt-item ${tone === 'bad' ? 'alert' : ''}`} onClick={() => setOpenId(d.id)}>
                    <span className="mv-text">
                      <b>{d.name}</b>
                      <span className={`small ${tone === 'ok' ? 'pos' : 'muted'}`}>{label}</span>
                    </span>
                    <b className="debt-balance">{money(Math.max(0, balance))} ›</b>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )
      })}

      <section className="card">
        <div className="stack">
          <button className="primary" onClick={() => setCreating(true)}>+ Nueva deuda</button>
          <button className="ghost" onClick={() => fileRef.current?.click()}>Cargar desde archivo</button>
        </div>
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

      {creating && (
        <NewDebtSheet
          onClose={() => setCreating(false)}
          onCreated={(d) => {
            setCreating(false)
            setOpenId(d.id)
            void runSync()
          }}
        />
      )}
    </>
  )
}

function NewDebtSheet({ onClose, onCreated }: { onClose: () => void; onCreated: (d: Debt) => void }) {
  const [direction, setDirection] = useState<Debt['direction']>('me-deben')
  const [name, setName] = useState('')
  const [amount, setAmount] = useState(0)
  const [date, setDate] = useState(todayISO())
  const [ea, setEa] = useState('')
  const [installment, setInstallment] = useState(0)
  const [dueDay, setDueDay] = useState(25)
  const [bankName, setBankName] = useState('')

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !amount) return
    const keywords = (bankName || name).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
    const d = await createDebt({
      name, direction, amount, date, installment, dueDay, keywords,
      ea: (Number(ea.replace(',', '.')) || 0) / 100,
    })
    onCreated(d)
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <form className="sheet" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <div className="sheet-head">
          <h2>Nueva deuda</h2>
          <button type="button" className="ghost" onClick={onClose}>Cerrar</button>
        </div>

        <div className="segmented">
          <button type="button" className={direction === 'me-deben' ? 'on income' : ''} onClick={() => setDirection('me-deben')}>Me deben</button>
          <button type="button" className={direction === 'debo' ? 'on expense' : ''} onClick={() => setDirection('debo')}>Yo debo</button>
        </div>

        <label>
          <span>{direction === 'me-deben' ? '¿Quién te debe?' : '¿A quién le debes?'}</span>
          <input placeholder="Nombre" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
        </label>

        <label className="amount-field">
          <span>{direction === 'me-deben' ? '¿Cuánto le prestaste?' : '¿Cuánto te prestó?'}</span>
          <div>
            <b>$</b>
            <input inputMode="numeric" placeholder="0" value={moneyInput(amount)} onChange={(e) => setAmount(parseMoney(e.target.value))} />
          </div>
        </label>

        <div className="row">
          <label>
            <span>Fecha del préstamo</span>
            <input type="date" value={date} required onChange={(e) => setDate(e.target.value)} />
          </label>
          <label>
            <span>Interés (% EA)</span>
            <input inputMode="decimal" placeholder="0 = sin interés" value={ea} onChange={(e) => setEa(e.target.value)} />
          </label>
        </div>

        <div className="row">
          <label>
            <span>Cuota mensual (opcional)</span>
            <input inputMode="numeric" placeholder="Sin cuota fija" value={moneyInput(installment)} onChange={(e) => setInstallment(parseMoney(e.target.value))} />
          </label>
          {installment > 0 && (
            <label>
              <span>Día de pago</span>
              <input inputMode="numeric" value={dueDay} onChange={(e) => setDueDay(Math.min(28, Math.max(1, Number(e.target.value) || 1)))} />
            </label>
          )}
        </div>

        <label>
          <span>Cómo aparece en las alertas del banco (opcional)</span>
          <input placeholder="Ej: MARIA PEREZ, PEREZ GOMEZ" value={bankName} onChange={(e) => setBankName(e.target.value)} />
        </label>
        <p className="muted small">
          {direction === 'me-deben'
            ? 'Cuando te llegue una transferencia de esa persona, la app la anotará como abono.'
            : 'Cuando le transfieras a esa persona, la app lo anotará como pago.'}
        </p>

        <button className="primary" disabled={!name.trim() || !amount}>Guardar deuda</button>
      </form>
    </div>
  )
}

function DebtView({ debt, onChange }: { debt: Debt; onChange: () => void }) {
  const w = words(debt)
  const today = todayISO()
  const sim = simulateDebt(debt, today)
  const { overdue, next } = overdueInstallments(debt, today)
  const [whatIf, setWhatIf] = useState(debt.installment)
  const plan = payoffProjection({ ...debt, installment: whatIf }, sim.balance, today)
  const currentEA = [...debt.rates].sort((a, b) => a.from.localeCompare(b.from)).filter((r) => r.from <= today).pop()?.ea ?? 0
  const lastPayment = debt.payments.map((p) => p.date).sort().pop()
  const [form, setForm] = useState<'pago' | 'prestamo' | null>(null)
  const [showAll, setShowAll] = useState(false)
  const rows = [...sim.rows].reverse()
  const settled = sim.balance < SETTLED
  const done = () => {
    setForm(null)
    onChange()
  }

  return (
    <>
      <section className="card hero">
        <p className="muted">{w.title}</p>
        <p className={`hero-amount ${settled ? 'pos' : ''}`}>{settled ? 'Pagada ✓' : money(sim.balance)}</p>
        <p className="muted small">
          {currentEA > 0 ? `Capital + intereses − pagos · hoy al ${(currentEA * 100).toFixed(1).replace('.0', '')} % EA` : 'Sin intereses · lo prestado menos lo pagado'}
        </p>
      </section>

      {overdue.length > 0 && !settled && (
        <section className="card alert">
          <b>⚠️ {w.behind(overdue.length)}: {overdue.map((d) => monthLabel(d.slice(0, 7)).toLowerCase()).join(' y ')}</b>
          <p className="small">
            Para ponerse al día: {money(debt.installment * overdue.length)}.
            {sim.interestSinceLastEvent > 0 && ` Desde el último pago (${lastPayment ? shortDate(lastPayment) : '—'}) van ${money(sim.interestSinceLastEvent)} de intereses.`}
          </p>
        </section>
      )}

      <section className="grid2">
        <div className="card stat">
          <span className="muted small">Total prestado</span>
          <b>{money(sim.disbursed)}</b>
        </div>
        <div className="card stat">
          <span className="muted small">{w.paid}</span>
          <b className="pos">{money(sim.paid)}</b>
        </div>
        {currentEA > 0 && (
          <div className="card stat">
            <span className="muted small">Intereses causados</span>
            <b className="warn-text">{money(sim.interestTotal)}</b>
          </div>
        )}
        {debt.installment > 0 && !settled && (
          <div className="card stat">
            <span className="muted small">Próxima cuota</span>
            <b className={overdue.length ? 'neg' : ''}>{money(debt.installment * (overdue.length + 1))}</b>
            <span className="muted small">{next ? shortDate(next) : '—'}{overdue.length ? ' (incluye atrasadas)' : ''}</span>
          </div>
        )}
      </section>

      {sim.series.length > 2 && (
        <section className="card">
          <h3>Cómo ha ido el saldo</h3>
          <BalanceChart series={sim.series} />
        </section>
      )}

      {!settled && (
        <section className="card">
          <h3>{w.when}</h3>
          {currentEA > 0 && (
            <p className="muted small">
              Cada mes la deuda genera unos <b className="warn-text">{money(plan.monthlyInterest)}</b> de interés. Lo que se pague por encima de eso baja el capital.
            </p>
          )}
          <label className="whatif">
            <span>{w.ifPays}</span>
            <input inputMode="numeric" placeholder="0" value={moneyInput(whatIf)} onChange={(e) => setWhatIf(parseMoney(e.target.value))} />
          </label>
          <p className="pill">
            {!whatIf
              ? 'Escribe una cuota mensual para ver cuándo termina.'
              : plan.months === Infinity
                ? 'Con esa cuota no alcanza a cubrir los intereses: la deuda seguiría creciendo.'
                : `Terminaría en ${monthLabel(plan.endMonth).toLowerCase()} · ${plan.installments} cuota${plan.installments > 1 ? 's' : ''}`}
          </p>
        </section>
      )}

      <section className="card">
        <div className="inbox-head">
          <h3>Movimientos</h3>
          <span className="head-actions">
            <button className="link" onClick={() => setForm(form === 'prestamo' ? null : 'prestamo')}>+ Préstamo</button>
            <button className="link" onClick={() => setForm(form === 'pago' ? null : 'pago')}>+ {w.owe ? 'Pago' : 'Abono'}</button>
          </span>
        </div>
        {form && <EventForm debt={debt} type={form} onDone={done} />}
        <ul className="list-plain debt-rows">
          {(showAll ? rows : rows.slice(0, 8)).map((r, i) => (
            <li key={`${r.date}-${i}`}>
              <span>
                <b className={r.type === 'prestamo' ? 'warn-text' : 'pos'}>
                  {r.type === 'prestamo' ? '▲ ' : '✓ '}
                  {r.type === 'prestamo' ? r.note || 'Préstamo' : w.owe ? 'Pago' : 'Abono'}
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

// Registrar un pago/abono, o un préstamo adicional.
function EventForm({ debt, type, onDone }: { debt: Debt; type: 'pago' | 'prestamo'; onDone: () => void }) {
  const w = words(debt)
  const [date, setDate] = useState(todayISO())
  const [amount, setAmount] = useState(type === 'pago' ? debt.installment : 0)
  const [note, setNote] = useState('')
  // Pago de lo que debes = gasto; abono que te hacen = ingreso; prestar = gasto.
  const movementKind = (type === 'pago') === w.owe ? 'gasto' : 'ingreso'
  const [alsoMovement, setAlsoMovement] = useState(type === 'pago')

  const save = async () => {
    if (!amount) return
    if (type === 'pago') await addDebtPayment(debt.id, { date, amount, note: note.trim(), source: 'app' })
    else await addDebtDisbursement(debt.id, { date, amount, note: note.trim() || 'Préstamo' })
    if (alsoMovement) {
      const description =
        type === 'pago' ? (w.owe ? `Pago deuda ${debt.name}` : `Abono de ${debt.name}`) : w.owe ? `Préstamo de ${debt.name}` : `Préstamo a ${debt.name}`
      await saveMovement({
        date, kind: movementKind,
        category: movementKind === 'gasto' ? (w.owe ? 'Deudas' : 'Otros') : w.owe ? 'Préstamos' : 'Otros',
        subcategory: movementKind === 'gasto' ? 'Otros' : w.owe ? 'Préstamos' : 'Otros',
        description, amount, recurrence: type === 'pago' && debt.installment > 0 ? 'fijo' : 'ocasional', source: 'manual', createdAt: Date.now(),
      })
    }
    onDone()
  }

  return (
    <div className="sheet debt-form">
      <b>{type === 'pago' ? w.pay : w.more}</b>
      <div className="row">
        <label>
          <span>Fecha</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          <span>Valor</span>
          <input inputMode="numeric" autoFocus value={moneyInput(amount)} onChange={(e) => setAmount(parseMoney(e.target.value))} />
        </label>
      </div>
      <label>
        <span>Nota</span>
        <input placeholder={type === 'pago' ? 'Ej: cuota de septiembre' : 'Ej: 2do préstamo'} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <label className="check">
        <input type="checkbox" checked={alsoMovement} onChange={(e) => setAlsoMovement(e.target.checked)} />
        <span>Anotarlo también en mis {movementKind === 'gasto' ? 'gastos' : 'ingresos'} del mes</span>
      </label>
      <button className="primary" disabled={!amount} onClick={save}>Guardar</button>
    </div>
  )
}

function BalanceChart({ series }: { series: { date: string; balance: number }[] }) {
  if (series.length < 2) return null
  const W = 340, H = 150, pad = { t: 10, r: 8, b: 20, l: 8 }
  const t0 = Date.parse(series[0].date), t1 = Date.parse(series[series.length - 1].date)
  const max = Math.max(1, ...series.map((p) => p.balance)) * 1.08
  const x = (d: string) => pad.l + ((Date.parse(d) - t0) / (t1 - t0 || 1)) * (W - pad.l - pad.r)
  const y = (v: number) => pad.t + (1 - Math.max(0, v) / max) * (H - pad.t - pad.b)
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
