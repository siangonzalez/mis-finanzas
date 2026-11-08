import { useLiveQuery } from 'dexie-react-hooks'
import { useRef, useState } from 'react'
import { categoriesFor, findCategory } from '../data/categories'
import { db, saveCardSummary, type InboxItem, type MailStatement } from '../data/db'
import { syncGmail, isGmailConfigured, statementFiles } from '../import/gmail'
import { accept, acceptAll, ignore, ingest, ingestStatement, restore, updateSuggestion } from '../import/inbox'
import { PdfPasswordError, readPdfLines } from '../import/pdf'
import { readNequiDocx, statementFromPdfLines, statementItems } from '../import/statements'
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
  const ownTransfers = useLiveQuery(() => db.inbox.where('status').equals('propia').reverse().sortBy('date'), []) ?? []
  const [showOwn, setShowOwn] = useState(false)
  const statementRef = useRef<HTMLInputElement>(null)
  // PDF con contraseña: los archivos que faltan y la contraseña que escribes.
  // La contraseña vive solo en memoria mientras se leen los archivos.
  const [needPassword, setNeedPassword] = useState<{ files: File[]; wrong: boolean; other: boolean } | null>(null)
  const [password, setPassword] = useState('')
  // Las claves que escribiste en esta carga (cada banco puede tener la suya). Solo en memoria.
  const passwords = useRef<string[]>([])
  const askedFor = useRef<File | null>(null)
  const totals = useRef({ rows: 0, added: 0, own: 0, repeated: 0 })
  const notes = useRef<string[]>([])
  // Extractos que llegaron por correo y el que se está leyendo.
  const mailStatements = useLiveQuery(() => db.extractos.where('status').equals('pendiente').sortBy('date'), []) ?? []
  const reading = useRef<string[]>([])
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
      const alerts = r.added ? `Encontré ${r.added} movimientos nuevos.` : `Revisé ${r.read} correos; no hay alertas nuevas.`
      const statements = r.statements ? ` Llegaron ${r.statements === 1 ? '1 extracto' : `${r.statements} extractos`}: léelos abajo.` : ''
      setMessage(alerts + statements + (r.statementsError ? ` ${r.statementsError}` : ''))
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

  const readStatement = async (f: File) => {
    const buf = await f.arrayBuffer()
    if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') return statementFromPdfLines(await readPdfLines(buf, passwords.current))
    const rows = readNequiDocx(buf)
    return { bank: 'Nequi', items: statementItems(rows) }
  }

  const loadStatements = async (files: File[]) => {
    setBusy(true)
    setMessage('')
    const t = totals.current
    try {
      for (let i = 0; i < files.length; i++) {
        let statement
        try {
          statement = await readStatement(files[i])
        } catch (e) {
          if (e instanceof PdfPasswordError) {
            const again = askedFor.current === files[i]
            askedFor.current = files[i]
            setNeedPassword({ files: files.slice(i), wrong: again, other: !again && passwords.current.length > 0 })
            setPassword('')
            return
          }
          // Errores del lector de Word o PDF ("invalid zip data"…): el archivo no es un extracto que la app conozca.
          const why = e instanceof Error && !/zip|invalid pdf|unexpected/i.test(e.message) ? e.message : 'no parece un extracto que la app sepa leer.'
          throw new Error(`${files[i].name}: ${why}`)
        }
        if ('card' in statement && statement.card) await saveCardSummary(statement.card)
        if ('note' in statement && statement.note) notes.current.push(statement.note)
        const res = await ingestStatement(statement.items)
        t.rows += statement.items.length
        t.added += res.added
        t.own += res.own
        t.repeated += res.repeated
      }
      setNeedPassword(null)
      setPassword('')
      passwords.current = []
      askedFor.current = null
      if (reading.current.length) await db.extractos.where('id').anyOf(reading.current).modify({ status: 'leido' })
      reading.current = []
      const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`
      setMessage(
        `Leí ${n(t.rows, 'movimiento', 'movimientos')}: ${n(t.added, 'nuevo', 'nuevos')} para revisar` +
          (t.repeated ? `, ${t.repeated} que ya tenías por correo` : '') +
          (t.own ? ` y ${t.own} entre tus cuentas (no cuentan como gasto ni ingreso)` : '') + '.' +
          (notes.current.length ? ` ${notes.current.join(' ')}` : ''),
      )
      notes.current = []
      totals.current = { rows: 0, added: 0, own: 0, repeated: 0 }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'No pude leer el extracto.')
      notes.current = []
      reading.current = []
      passwords.current = []
      askedFor.current = null
      setNeedPassword(null)
      totals.current = { rows: 0, added: 0, own: 0, repeated: 0 }
    } finally {
      setBusy(false)
    }
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
        <div className="stack">
          <button className="ghost" disabled={busy} onClick={() => statementRef.current?.click()}>
            {busy ? 'Leyendo…' : 'Cargar extracto (Nequi, Tuya, Bancolombia, Nu o Davivienda)'}
          </button>
        </div>
        {needPassword && (
          <form
            className="password-box"
            onSubmit={(e) => {
              e.preventDefault()
              if (!password) return
              passwords.current = [...passwords.current, password]
              void loadStatements(needPassword.files)
            }}
          >
            <span className="small">
              {needPassword.wrong ? 'Esa contraseña no abre' : needPassword.other ? 'Este archivo tiene otra contraseña:' : 'Escribe la contraseña de'} <b>{needPassword.files[0].name}</b>
              {needPassword.wrong
                ? '. Revisa mayúsculas y que sea la de ese banco (puntos y espacios no importan).'
                : ' (en Nequi suele ser tu número de cédula). Solo se usa para abrir el archivo aquí; no se guarda.'}
            </span>
            <div className="row">
              <input className="settings-input" type="password" autoComplete="off" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
              <button className="primary" disabled={!password || busy}>Abrir</button>
            </div>
            <button
              type="button"
              className="link"
              onClick={() => {
                setNeedPassword(null)
                setPassword('')
                reading.current = []
                passwords.current = []
                askedFor.current = null
                totals.current = { rows: 0, added: 0, own: 0, repeated: 0 }
              }}
            >
              Cancelar
            </button>
          </form>
        )}
        <input
          ref={statementRef}
          type="file"
          accept=".docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) void loadStatements(Array.from(e.target.files))
            e.target.value = ''
          }}
        />
        {message && <p className="pill">{message}</p>}
      </section>

      {mailStatements.length > 0 && (
        <section className="card">
          <h3>Extractos que llegaron por correo</h3>
          <p className="muted small">
            Al leerlos, la app los compara con lo que ya tienes: lo que falta queda aquí para revisar y lo repetido no se cuenta
            dos veces. Si el PDF tiene contraseña, la escribes tú aquí.
          </p>
          <ul className="list-plain mail-statements">
            {mailStatements.map((s) => (
              <MailStatementRow
                key={s.id}
                s={s}
                busy={busy}
                onRead={() => {
                  reading.current = [s.id]
                  void loadStatements(statementFiles(s))
                }}
              />
            ))}
          </ul>
        </section>
      )}

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

      {ownTransfers.length > 0 && (
        <section className="card">
          <button className="link" onClick={() => setShowOwn(!showOwn)}>
            {showOwn ? 'Ocultar' : 'Ver'} {ownTransfers.length === 1 ? '1 movimiento' : `${ownTransfers.length} movimientos`} entre tus cuentas
          </button>
          <p className="muted small">Pasar plata de una cuenta tuya a otra no es gasto ni ingreso, así que no se suma.</p>
          {showOwn && (
            <ul className="list-plain dupes">
              {ownTransfers.map((d) => (
                <li key={d.id}>
                  <span>
                    <b>{d.merchant}</b>
                    <span className="muted small"> · {d.bank} · {d.date}</span>
                  </span>
                  <span>
                    {d.kind === 'ingreso' ? '+' : '−'}{money(d.amount)} <button className="link" onClick={() => restore(d)}>Sí cuenta</button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

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

function MailStatementRow({ s, busy, onRead }: { s: MailStatement; busy: boolean; onRead: () => void }) {
  return (
    <li>
      <span className="mv-text">
        <b>{s.subject || s.files[0]?.name}</b>
        <span className="small muted">{dayLabel(s.date.slice(0, 10))} · {s.from.replace(/<.*>/, '').trim() || s.from}</span>
      </span>
      <span className="head-actions">
        <button className="link pos" disabled={busy} onClick={onRead}>Leer</button>
        <button className="link" onClick={() => db.extractos.update(s.id, { status: 'descartado' })}>Descartar</button>
      </span>
    </li>
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
