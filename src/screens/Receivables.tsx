import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import {
  activeReceivables, addReceivablePayment, db, deleteReceivable, markReceivablePaid, rejectReceivablePayment, removeReceivablePayment, saveMovement, saveReceivable,
  type InboxItem, type Receivable,
} from '../data/db'
import { updateSuggestion } from '../import/inbox'
import { daysBetween, proposedPayments, received, remaining } from '../lib/receivables'
import { money, moneyInput, parseMoney, todayISO } from '../lib/format'

function shortDate(d: string) {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })
}

function ago(days: number, date: string) {
  return days <= 0 ? 'hoy' : days === 1 ? 'ayer' : `el ${shortDate(date)} · hace ${days} días`
}

// Cuentas de cobro: trabajos hechos que todavía no te pagan.
export function ReceivableList() {
  const list = useLiveQuery(activeReceivables, [])
  const inbox = useLiveQuery(() => db.inbox.toArray(), []) ?? []
  const [editing, setEditing] = useState<Receivable | 'new' | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [showPaid, setShowPaid] = useState(false)
  if (!list) return null

  const today = todayISO()
  const pending = list.filter((r) => !r.paid).sort((a, b) => a.sentDate.localeCompare(b.sentDate))
  const paid = list.filter((r) => r.paid).sort((a, b) => b.paid!.date.localeCompare(a.paid!.date))
  const proposals = proposedPayments(pending, inbox)
  const total = pending.reduce((s, r) => s + remaining(r), 0)

  return (
    <section>
      <div className="group-head">
        <h4 className="group-title">Por cobrar{total > 0 && ` · ${money(total)}`}</h4>
        <button className="link" onClick={() => setEditing('new')}>+ Cuenta de cobro</button>
      </div>
      {!pending.length && (
        <p className="muted small group-note">
          Anota aquí las cuentas de cobro que envías por trabajos ya hechos. Cuando te llegue el pago en tus alertas, la app te lo
          propone para que lo confirmes.
        </p>
      )}
      <ul className="debt-list">
        {pending.map((r) => {
          const proposal = proposals.get(r.id)
          const late = r.dueDate && r.dueDate < today ? daysBetween(r.dueDate, today) : 0
          const open = openId === r.id
          const abonado = received(r)
          return (
            <li key={r.id} className={`card card-debt ${late ? 'alert' : ''}`}>
              <button className="debt-item-row plain" onClick={() => setOpenId(open ? null : r.id)}>
                <span className="mv-text">
                  <b>{r.client}</b>
                  <span className="small muted">{r.concept}</span>
                  <span className={`small ${late ? 'neg' : 'muted'}`}>
                    {late ? `⚠️ Debían pagarte el ${shortDate(r.dueDate!)} (hace ${late} día${late > 1 ? 's' : ''})`
                      : r.dueDate ? `Enviada el ${shortDate(r.sentDate)} · pago el ${shortDate(r.dueDate)}`
                      : `Enviada ${ago(daysBetween(r.sentDate, today), r.sentDate)}`}
                  </span>
                  {abonado > 0 && <span className="small pos">Te abonaron {money(abonado)} de {money(r.amount)} · faltan {money(remaining(r))}</span>}
                </span>
                <b className="debt-balance">{money(remaining(r))}</b>
              </button>
              {proposal && <Proposal r={r} item={proposal} />}
              {open && <Actions r={r} onEdit={() => setEditing(r)} onDone={() => setOpenId(null)} />}
            </li>
          )
        })}
      </ul>

      {paid.length > 0 && (
        <>
          <button className="link group-note" onClick={() => setShowPaid(!showPaid)}>
            {showPaid ? 'Ocultar cobros pagados' : `Ya te pagaron (${paid.length})`}
          </button>
          {showPaid && (
            <ul className="debt-list">
              {paid.map((r) => {
                const withheld = r.amount - r.paid!.amount
                return (
                  <li key={r.id} className="card card-debt">
                    <div className="debt-item-row">
                      <span className="mv-text">
                        <b>{r.client}</b>
                        <span className="small muted">{r.concept}</span>
                        <span className="small pos">
                          ✓ Te pagaron {money(r.paid!.amount)} el {shortDate(r.paid!.date)}
                          {withheld > 0 && ` · ${money(withheld)} menos (¿retención?)`}
                        </span>
                      </span>
                      <b className="debt-balance muted">{money(r.amount)}</b>
                    </div>
                    <button className="link card-paid" onClick={() => markReceivablePaid(r.id, undefined)}>Deshacer pago</button>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}

      {editing && <ReceivableSheet initial={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </section>
  )
}

// "¿Este ingreso es el pago?" Confirmarlo lo deja como pagado y el ingreso pasa a Honorarios.
function Proposal({ r, item }: { r: Receivable; item: InboxItem }) {
  const confirm = async () => {
    await markReceivablePaid(r.id, { date: item.date, amount: received(r) + item.amount, inboxId: item.id })
    if (item.status === 'pendiente') await updateSuggestion(item, 'Honorarios', 'Honorarios')
  }
  return (
    <div className="proposal">
      <p className="small">
        💰 ¿Es este el pago? Te llegaron <b>{money(item.amount)}</b> de {item.merchant || item.bank} el {shortDate(item.date)}
        {item.amount < remaining(r) && ` (${money(remaining(r) - item.amount)} menos, quizá por retención)`}.
      </p>
      <span className="head-actions">
        <button className="link pos" onClick={confirm}>Sí, es el pago</button>
        <button className="link" onClick={() => rejectReceivablePayment(r.id, item.id)}>No</button>
      </span>
    </div>
  )
}

function Actions({ r, onEdit, onDone }: { r: Receivable; onEdit: () => void; onDone: () => void }) {
  const [paying, setPaying] = useState(false)
  const [date, setDate] = useState(todayISO())
  const due = remaining(r)
  const [amount, setAmount] = useState(due)
  const [alsoIncome, setAlsoIncome] = useState(true)
  // Menos del 85 % de lo que falta es un abono; más, el pago completo (lo demás sería retención).
  const [partial, setPartial] = useState(false)
  const [touched, setTouched] = useState(false)
  const changeAmount = (n: number) => {
    setAmount(n)
    if (!touched) setPartial(n > 0 && n < due * 0.85)
  }

  const save = async () => {
    if (!amount) return
    if (partial) await addReceivablePayment(r.id, { date, amount })
    else await markReceivablePaid(r.id, { date, amount: received(r) + amount })
    if (alsoIncome) {
      await saveMovement({
        date, kind: 'ingreso', category: 'Honorarios', subcategory: 'Honorarios', description: `${r.client} · ${r.concept}`,
        amount, recurrence: 'ocasional', source: 'manual', createdAt: Date.now(),
      })
    }
    onDone()
  }

  if (!paying) {
    return (
      <>
        {(r.payments ?? []).length > 0 && (
          <ul className="finding-items">
            {r.payments!.map((p, i) => (
              <li key={i} className="small">
                <span>Abono del {shortDate(p.date)}</span>
                <span>
                  <b>{money(p.amount)}</b>{' '}
                  <button className="link neg" onClick={() => confirm(`¿Quitar el abono de ${money(p.amount)}?`) && removeReceivablePayment(r.id, i)}>Quitar</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      <span className="head-actions receivable-actions">
        <button className="link pos" onClick={() => setPaying(true)}>Me pagaron</button>
        <button className="link" onClick={onEdit}>Editar</button>
        <button className="link neg" onClick={() => confirm(`¿Borrar la cuenta de cobro a ${r.client}?`) && deleteReceivable(r.id)}>Borrar</button>
      </span>
      </>
    )
  }
  return (
    <div className="sheet debt-form">
      <div className="row">
        <label>
          <span>Fecha del pago</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          <span>Te pagaron</span>
          <input inputMode="numeric" autoFocus value={moneyInput(amount)} onChange={(e) => changeAmount(parseMoney(e.target.value))} />
        </label>
      </div>
      <label className="check">
        <input type="checkbox" checked={partial} onChange={(e) => { setTouched(true); setPartial(e.target.checked) }} />
        <span>
          {partial
            ? `Es un abono: todavía te deberían ${money(Math.max(0, due - amount))}.`
            : 'Es un abono: todavía me deben una parte.'}
        </span>
      </label>
      {!partial && amount > 0 && amount < due && (
        <p className="muted small">Se cierra la cuenta de cobro; los {money(due - amount)} de diferencia quedan como posible retención.</p>
      )}
      <label className="check">
        <input type="checkbox" checked={alsoIncome} onChange={(e) => setAlsoIncome(e.target.checked)} />
        <span>Anotarlo en mis ingresos (Honorarios). Desmárcalo si el pago ya llegó en tus alertas.</span>
      </label>
      <button className="primary" disabled={!amount} onClick={save}>{partial ? 'Guardar abono' : 'Guardar'}</button>
    </div>
  )
}

function ReceivableSheet({ initial, onClose }: { initial?: Receivable; onClose: () => void }) {
  const [client, setClient] = useState(initial?.client ?? '')
  const [concept, setConcept] = useState(initial?.concept ?? '')
  const [amount, setAmount] = useState(initial?.amount ?? 0)
  const [sentDate, setSentDate] = useState(initial?.sentDate ?? todayISO())
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? '')
  const [bankName, setBankName] = useState(initial?.keywords.join(', ') ?? '')

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!client.trim() || !amount) return
    await saveReceivable({
      ...initial,
      client: client.trim(), concept: concept.trim(), amount, sentDate, dueDate: dueDate || undefined,
      keywords: bankName.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
    })
    onClose()
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <form className="sheet" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <div className="sheet-head">
          <h2>{initial ? 'Editar cuenta de cobro' : 'Nueva cuenta de cobro'}</h2>
          <button type="button" className="ghost" onClick={onClose}>Cerrar</button>
        </div>
        <label>
          <span>¿A quién le cobras?</span>
          <input placeholder="Ej: Universidad Sergio Arboleda" value={client} autoFocus={!initial} onChange={(e) => setClient(e.target.value)} />
        </label>
        <label>
          <span>¿Por qué trabajo?</span>
          <input placeholder="Ej: Locuciones Betplay" value={concept} onChange={(e) => setConcept(e.target.value)} />
        </label>
        <label className="amount-field">
          <span>Valor de la cuenta de cobro</span>
          <div>
            <b>$</b>
            <input inputMode="numeric" placeholder="0" value={moneyInput(amount)} onChange={(e) => setAmount(parseMoney(e.target.value))} />
          </div>
        </label>
        <div className="row">
          <label>
            <span>Enviada el</span>
            <input type="date" value={sentDate} required onChange={(e) => setSentDate(e.target.value)} />
          </label>
          <label>
            <span>Te pagan el (opcional)</span>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </label>
        </div>
        <label>
          <span>Cómo aparece en las alertas del banco (opcional)</span>
          <input placeholder="Ej: SERGIO ARBOLEDA" value={bankName} onChange={(e) => setBankName(e.target.value)} />
        </label>
        <p className="muted small">
          Si no lo sabes, déjalo vacío: la app busca el nombre del cliente y también los ingresos por el valor exacto.
        </p>
        <button className="primary" disabled={!client.trim() || !amount}>Guardar</button>
      </form>
    </div>
  )
}
