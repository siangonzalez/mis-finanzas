import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { categoriesFor, findCategory } from '../data/categories'
import { db, type InboxItem } from '../data/db'
import { syncGmail, isGmailConfigured } from '../import/gmail'
import { accept, acceptAll, ignore, ingest, restore, updateSuggestion } from '../import/inbox'
import { dayLabel, money } from '../lib/format'

const SOURCE_LABEL: Record<InboxItem['source'], string> = {
  gmail: 'Correo',
  applepay: 'Apple Pay',
  sms: 'SMS',
  extracto: 'Extracto',
}

export function Inbox({ onGoToSettings }: { onGoToSettings: () => void }) {
  const pending = useLiveQuery(() => db.inbox.where('status').equals('pendiente').sortBy('date'), []) ?? []
  const duplicates = useLiveQuery(() => db.inbox.where('status').equals('duplicado').reverse().sortBy('date'), []) ?? []
  const gmailReady = useLiveQuery(isGmailConfigured, [])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [pasted, setPasted] = useState('')
  const [showDupes, setShowDupes] = useState(false)

  const sync = async () => {
    setBusy(true)
    setMessage('')
    try {
      const r = await syncGmail()
      setMessage(r.added ? `Encontré ${r.added} movimientos nuevos.` : `Revisé ${r.read} correos; no hay nada nuevo.`)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'No se pudo sincronizar.')
    } finally {
      setBusy(false)
    }
  }

  const addPasted = async () => {
    const added = await ingest([{ id: `pegado:${Date.now()}`, source: 'sms', text: pasted }])
    setMessage(added ? 'Alerta agregada para revisar.' : 'No reconocí esa alerta (o ya estaba).')
    if (added) setPasted('')
  }

  const acceptEverything = async () => {
    const n = await acceptAll()
    setMessage(`Agregaste ${n} movimientos a tus cuentas.`)
  }

  return (
    <>
      <section className="card">
        <h3>Movimientos automáticos</h3>
        {gmailReady ? (
          <button className="primary" disabled={busy} onClick={sync}>{busy ? 'Revisando Gmail…' : 'Revisar Gmail ahora'}</button>
        ) : (
          <>
            <p className="muted small">Conecta Gmail para traer las alertas de Bancolombia, Nequi, Davivienda y PSE.</p>
            <div className="stack">
              <button className="ghost" onClick={onGoToSettings}>Conectar Gmail</button>
            </div>
          </>
        )}
        {message && <p className="pill">{message}</p>}
      </section>

      {pending.length > 0 ? (
        <>
          <div className="inbox-head">
            <h3>Por revisar ({pending.length})</h3>
            <button className="link" onClick={acceptEverything}>Aceptar todos</button>
          </div>
          <ul className="inbox-list">
            {pending.map((item) => <PendingCard key={item.id} item={item} />)}
          </ul>
        </>
      ) : (
        <p className="muted center">No tienes movimientos por revisar. 🎉</p>
      )}

      <details className="card">
        <summary>Pegar una alerta (SMS o correo)</summary>
        <textarea
          className="paste"
          rows={4}
          placeholder="Bancolombia: Compraste $12.000,00 en … con tu T.Deb *1234, el 01/11/2026 a las 10:00."
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
        />
        <button className="ghost" disabled={!pasted.trim()} onClick={addPasted}>Agregar</button>
      </details>

      {duplicates.length > 0 && (
        <section className="card">
          <button className="link" onClick={() => setShowDupes(!showDupes)}>
            {showDupes ? 'Ocultar' : 'Ver'} {duplicates.length} avisos repetidos que descarté
          </button>
          {showDupes && (
            <ul className="list-plain dupes">
              {duplicates.map((d) => (
                <li key={d.id}>
                  <span>
                    <b>{d.merchant}</b>
                    <span className="muted small"> · {d.bank} · {d.date}</span>
                  </span>
                  <span>
                    {money(d.amount)} <button className="link" onClick={() => restore(d)}>No es repetido</button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  )
}

function PendingCard({ item }: { item: InboxItem }) {
  const cats = categoriesFor(item.kind)
  const cat = findCategory(item.kind, item.category)

  return (
    <li className="card inbox-card">
      <div className="inbox-top">
        <span className="mv-icon" style={{ background: `${cat.color}22` }}>{cat.emoji}</span>
        <span className="mv-text">
          <b>{item.merchant}</b>
          <span className="muted small">
            {dayLabel(item.date)}{item.time && ` · ${item.time}`} · {item.bank}{item.account && ` ${item.account}`} · {SOURCE_LABEL[item.source]}
          </span>
        </span>
        <b className={item.kind === 'ingreso' ? 'pos' : ''}>{item.kind === 'ingreso' ? '+' : '−'}{money(item.amount)}</b>
      </div>
      <div className="row">
        <select
          value={item.category}
          onChange={(e) => updateSuggestion(item, e.target.value, findCategory(item.kind, e.target.value).subcategories[0])}
        >
          {cats.map((c) => <option key={c.name} value={c.name}>{c.emoji} {c.name}</option>)}
        </select>
        {cat.subcategories.length > 1 && (
          <select value={item.subcategory} onChange={(e) => updateSuggestion(item, item.category, e.target.value)}>
            {cat.subcategories.map((s) => <option key={s}>{s}</option>)}
          </select>
        )}
      </div>
      <div className="row">
        <button className="ghost" onClick={() => ignore(item)}>Ignorar</button>
        <button className="primary" onClick={() => accept(item)}>Aceptar</button>
      </div>
    </li>
  )
}
