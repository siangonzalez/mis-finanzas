import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { activeBalances, activeCards, db, movementsSince, saveBalances } from '../data/db'
import { netFlow, reconcile, reconcileStart, type Reconciliation } from '../lib/balances'
import { daysInMonth, money, moneyInput, monthLabel, parseMoney, shiftMonth, todayISO } from '../lib/format'

const DEFAULT_ACCOUNTS = ['Bancolombia', 'Nequi']

function shortDate(d: string) {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })
}

// El día antes de que empiece el mes: lo que había ahí es con lo que empezaste.
function monthStartDate(date: string) {
  const prev = shiftMonth(date.slice(0, 7), -1)
  return `${prev}-${String(daysInMonth(prev)).padStart(2, '0')}`
}

export async function loadRealBalance() {
  const entries = await activeBalances()
  if (!entries.length) return null
  const movements = await movementsSince(reconcileStart(entries))
  return reconcile(entries, movements, (await db.inbox.toArray()).filter((i) => !i.deleted), await activeCards(), todayISO())
}

export function gapText(r: Reconciliation) {
  const amount = money(Math.abs(r.gap))
  if (r.gap < 0) {
    return r.atLeast
      ? `Faltan al menos ${amount} de gastos por registrar: lo anotado este mes no cuadra con lo que hay.`
      : `Desde el ${shortDate(r.since)} faltan ${amount} de gastos por registrar.`
  }
  return `Desde el ${shortDate(r.since)} hay ${amount} más de lo esperado: falta registrar un ingreso.`
}

// Lo que hay de verdad en tus cuentas. El Resumen solo sabe lo que entró y salió.
export function RealBalance({ onReview }: { onReview: () => void }) {
  const real = useLiveQuery(loadRealBalance, [])
  const [editing, setEditing] = useState(false)
  const [showCuadre, setShowCuadre] = useState(false)
  if (real === undefined) return null
  const today = todayISO()

  return (
    <section className={`card real-balance ${real?.gap ? 'warn' : ''}`}>
      {real ? (
        <>
          <div className="group-head">
            <span className="muted small">En tus cuentas</span>
            <button className="link" onClick={() => setEditing(true)}>Actualizar</button>
          </div>
          <b className="real-total">{money(real.now)}</b>
          <p className="muted small">
            {real.date === today
              ? `Anotado hoy: ${real.accounts.map((a) => `${a.account} ${money(a.amount)}`).join(' · ')}`
              : `Anotaste ${money(real.total)} el ${shortDate(real.date)}${real.changeSince ? `; desde entonces ${real.changeSince > 0 ? '+' : '−'}${money(Math.abs(real.changeSince))} en movimientos registrados` : '; desde entonces no hay movimientos registrados'}. Actualízalo de vez en cuando para que no se aleje del banco.`}
          </p>
          {real.gap !== 0 && (
            <p className="small real-gap">
              {gapText(real)} <button className="link" onClick={onReview}>Ir a Revisar ›</button>
            </p>
          )}
          <button className="link" onClick={() => setShowCuadre(true)}>Ver el cuadre paso a paso</button>
        </>
      ) : (
        <>
          <p className="small">Anota cuánto hay en tus cuentas para saber si la app está al día.</p>
          <button className="link" onClick={() => setEditing(true)}>Anotar mis saldos</button>
        </>
      )}
      {editing && <BalanceSheet real={real} onClose={() => setEditing(false)} />}
      {showCuadre && real && <CuadreSheet real={real} onReview={onReview} onClose={() => setShowCuadre(false)} />}
    </section>
  )
}

function Line({ label, value, sign, strong, muted }: { label: string; value: number | null; sign?: '+' | '−' | '='; strong?: boolean; muted?: boolean }) {
  return (
    <li className={`${strong ? 'strong' : ''} ${muted ? 'muted' : ''}`}>
      <span>{sign && <b className="cuadre-sign">{sign}</b>}{label}</span>
      <b>{value === null ? '¿?' : money(value)}</b>
    </li>
  )
}

// Lo que había + lo que entró − lo que salió = lo que debería haber; comparado con lo que hay.
function CuadreSheet({ real, onReview, onClose }: { real: Reconciliation; onReview: () => void; onClose: () => void }) {
  const [askStart, setAskStart] = useState(false)
  const f = real.flow
  const expected = real.start === null ? null : real.start + netFlow(f)
  const diff = expected === null ? null : real.total - expected
  const startLabel = real.start === null ? `Tenías al empezar ${monthLabel(real.date.slice(0, 7)).toLowerCase()}` : `Tenías el ${shortDate(real.since)}`
  const ownOut = f.own - f.marked

  if (askStart) {
    return (
      <BalanceSheet
        real={real}
        date={monthStartDate(real.date)}
        title={`¿Cuánto tenías al terminar ${monthLabel(shiftMonth(real.date.slice(0, 7), -1)).toLowerCase()}?`}
        hint="Míralo en el extracto o en la app de cada banco (saldo al último día del mes). Con esto el cuadre queda exacto."
        blank
        onClose={onClose}
      />
    )
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>Cuadre de tus cuentas</h2>
          <button type="button" className="ghost" onClick={onClose}>Cerrar</button>
        </div>
        <ul className="cuadre">
          <Line label={startLabel} value={real.start} />
          <Line sign="+" label="Entró a tus cuentas" value={f.income} />
          <Line sign="−" label="Salió de tus cuentas" value={f.expenses} />
          {ownOut !== 0 && <Line sign={ownOut > 0 ? '+' : '−'} label="Pagos a tarjetas y entre tus cuentas" value={Math.abs(ownOut)} />}
          <Line sign="=" label="Debería haber" value={expected} strong />
          <Line label={`Hay en tus cuentas (anotado el ${shortDate(real.date)})`} value={real.total} strong />
          {diff !== null && (
            <Line label={Math.abs(diff) < 1_000 ? 'Cuadra ✓' : diff < 0 ? 'Falta por registrar' : 'Hay de más (falta un ingreso)'} value={Math.abs(diff) < 1_000 ? 0 : Math.abs(diff)} strong />
          )}
          {f.credit > 0 && <Line label="Compras con tarjeta de crédito (no salen de tus cuentas hasta que la pagas)" value={f.credit} muted />}
        </ul>
        {real.start === null ? (
          <>
            <p className="small">
              Falta un dato: con cuánto empezaste el mes. Sin él, la app solo sabe que faltan al menos {money(Math.abs(real.gap))} de gastos.
            </p>
            <button className="primary" onClick={() => setAskStart(true)}>Anotar con cuánto empecé el mes</button>
          </>
        ) : (
          diff !== null && Math.abs(diff) >= 1_000 && (
            <p className="small">
              {diff < 0
                ? 'Busca en Revisar, en los extractos que lleguen (pagos con QR, Nequi a Nequi, retiros) y en lo que pagaste en efectivo.'
                : 'Puede faltar un ingreso, o un gasto quedó registrado dos veces.'}{' '}
              <button className="link" onClick={() => { onClose(); onReview() }}>Ir a Revisar ›</button>
            </p>
          )
        )}
        <p className="muted small">
          Se compara desde {real.start === null ? 'el inicio del mes' : `el ${shortDate(real.since)}`} hasta el {shortDate(real.date)}, que es cuando anotaste lo que hay.
        </p>
      </div>
    </div>
  )
}

function BalanceSheet({ real, onClose, date, title, hint, blank }: {
  real: Reconciliation | null
  onClose: () => void
  date?: string // por defecto, hoy
  title?: string
  hint?: string
  blank?: boolean // sin los saldos de la última vez (para otra fecha)
}) {
  const known = [...new Set([...(real?.accounts.map((a) => a.account) ?? []), ...DEFAULT_ACCOUNTS])]
  const [amounts, setAmounts] = useState<Record<string, number>>(
    Object.fromEntries(known.map((a) => [a, blank ? 0 : real?.accounts.find((x) => x.account === a)?.amount ?? 0])),
  )
  const [newName, setNewName] = useState('')
  const [newAmount, setNewAmount] = useState(0)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = newName.trim()
    const rows = Object.entries(amounts).map(([account, amount]) => ({ account, amount }))
    await saveBalances(date ?? todayISO(), name ? [...rows, { account: name, amount: newAmount }] : rows)
    onClose()
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <form className="sheet" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <div className="sheet-head">
          <h2>{title ?? '¿Cuánto hay en tus cuentas hoy?'}</h2>
          <button type="button" className="ghost" onClick={onClose}>Cerrar</button>
        </div>
        {known.map((account) => (
          <label key={account} className="amount-field">
            <span>{account}</span>
            <div>
              <b>$</b>
              <input
                inputMode="numeric" placeholder="0" value={moneyInput(amounts[account])}
                onChange={(e) => setAmounts({ ...amounts, [account]: parseMoney(e.target.value) })}
              />
            </div>
          </label>
        ))}
        <div className="row">
          <label>
            <span>Otra cuenta (opcional)</span>
            <input placeholder="Ej: Efectivo" value={newName} onChange={(e) => setNewName(e.target.value)} />
          </label>
          <label>
            <span>Saldo</span>
            <input inputMode="numeric" placeholder="0" value={moneyInput(newAmount)} onChange={(e) => setNewAmount(parseMoney(e.target.value))} />
          </label>
        </div>
        <p className="muted small">
          {hint ?? 'Cada vez que los actualices, la app compara el cambio con lo registrado y te dice si falta algo. Se guarda en tu dispositivo y en tu hoja de Google.'}
        </p>
        <button className="primary">Guardar</button>
      </form>
    </div>
  )
}
