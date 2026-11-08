import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { activeBalances, activeCards, db, movementsSince, saveBalances } from '../data/db'
import { reconcile, reconcileStart, type Reconciliation } from '../lib/balances'
import { money, moneyInput, parseMoney, todayISO } from '../lib/format'

const DEFAULT_ACCOUNTS = ['Bancolombia', 'Nequi']

function shortDate(d: string) {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })
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
        </>
      ) : (
        <>
          <p className="small">Anota cuánto hay en tus cuentas para saber si la app está al día.</p>
          <button className="link" onClick={() => setEditing(true)}>Anotar mis saldos</button>
        </>
      )}
      {editing && <BalanceSheet real={real} onClose={() => setEditing(false)} />}
    </section>
  )
}

function BalanceSheet({ real, onClose }: { real: Reconciliation | null; onClose: () => void }) {
  const known = [...new Set([...(real?.accounts.map((a) => a.account) ?? []), ...DEFAULT_ACCOUNTS])]
  const [amounts, setAmounts] = useState<Record<string, number>>(Object.fromEntries(known.map((a) => [a, real?.accounts.find((x) => x.account === a)?.amount ?? 0])))
  const [newName, setNewName] = useState('')
  const [newAmount, setNewAmount] = useState(0)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = newName.trim()
    const rows = Object.entries(amounts).map(([account, amount]) => ({ account, amount }))
    await saveBalances(todayISO(), name ? [...rows, { account: name, amount: newAmount }] : rows)
    onClose()
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <form className="sheet" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <div className="sheet-head">
          <h2>¿Cuánto hay en tus cuentas hoy?</h2>
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
          Cada vez que los actualices, la app compara el cambio con lo registrado y te dice si falta algo. Se guarda en tu dispositivo y en tu hoja de Google.
        </p>
        <button className="primary">Guardar</button>
      </form>
    </div>
  )
}
