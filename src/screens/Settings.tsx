import { useEffect, useRef, useState } from 'react'
import { deleteAll, exportBackup, getSetting, importBackup, setSetting } from '../data/db'
import { syncGmail } from '../import/gmail'
import { todayISO } from '../lib/format'

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

function csvCell(v: string | number) {
  const s = String(v)
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function Settings() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState('')

  const exportJson = async () => {
    const data = await exportBackup()
    download(`finanzas-${todayISO()}.json`, JSON.stringify(data, null, 2), 'application/json')
  }

  const exportCsv = async () => {
    const { movements } = await exportBackup()
    const header = ['Fecha', 'Tipo', 'Categoría', 'Subcategoría', 'Descripción', 'Valor', 'Fijo/Ocasional']
    const rows = movements
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((m) => [m.date, m.kind, m.category, m.subcategory, m.description, m.amount, m.recurrence])
    // Punto y coma: así lo abre bien Excel en español.
    const csv = [header, ...rows].map((r) => r.map(csvCell).join(';')).join('\n')
    download(`movimientos-${todayISO()}.csv`, '﻿' + csv, 'text/csv')
  }

  const importJson = async (file: File) => {
    try {
      if (!confirm('Esto reemplaza todos tus datos actuales por los del archivo. ¿Continuar?')) return
      await importBackup(JSON.parse(await file.text()))
      setMessage('Copia restaurada.')
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'No se pudo leer el archivo.')
    }
  }

  const wipe = async () => {
    if (!confirm('¿Borrar todos los movimientos y presupuestos? Esto no se puede deshacer.')) return
    await deleteAll()
    setMessage('Datos borrados.')
  }

  return (
    <>
      <GmailSettings />
      <ShortcutSettings />

      <section className="card">
        <h3>Tus datos</h3>
        <p className="muted small">
          Por ahora todo se guarda solo en este dispositivo. Haz una copia de vez en cuando para no perderlo si borras el
          navegador.
        </p>
        <div className="stack">
          <button className="primary" onClick={exportJson}>Descargar copia de seguridad</button>
          <button className="ghost" onClick={() => fileRef.current?.click()}>Restaurar copia</button>
          <button className="ghost" onClick={exportCsv}>Exportar a Excel (CSV)</button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) importJson(f)
            e.target.value = ''
          }}
        />
        {message && <p className="pill">{message}</p>}
      </section>

      <section className="card">
        <h3>Instalar en el iPhone</h3>
        <p className="muted small">
          Abre esta página en Safari, toca Compartir y luego "Agregar a pantalla de inicio". Se abre como una app, sin
          barra del navegador.
        </p>
      </section>

      <section className="card">
        <h3>Zona peligrosa</h3>
        <button className="danger" onClick={wipe}>Borrar todos los datos</button>
      </section>
    </>
  )
}

function GmailSettings() {
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    getSetting('gmail.url').then(setUrl)
    getSetting('gmail.token').then(setToken)
  }, [])

  const saveAndTest = async () => {
    const cleanUrl = url.trim()
    if (!/^https:\/\/script\.google\.com\/(a\/macros\/[^/]+|macros)\/s\/.+\/exec$/.test(cleanUrl)) {
      setStatus('La URL debe ser la de la aplicación web del script y terminar en /exec.')
      return
    }
    setBusy(true)
    setStatus('')
    await setSetting('gmail.url', cleanUrl)
    await setSetting('gmail.token', token.trim())
    try {
      const r = await syncGmail()
      setStatus(`Conectado. Leí ${r.read} correos y ${r.added} movimientos quedaron por revisar.`)
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'No se pudo conectar.')
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async () => {
    await setSetting('gmail.url', '')
    await setSetting('gmail.token', '')
    setUrl('')
    setToken('')
    setStatus('Gmail desconectado.')
  }

  return (
    <section className="card">
      <h3>Cuenta de Google</h3>
      <p className="muted small">
        Trae las alertas de Bancolombia, Nequi, Davivienda y PSE, y guarda tus deudas en una hoja de tu Drive, con un script que instalas en tu propia cuenta de
        Google. Los pasos están en <code>integraciones/README.md</code>.
      </p>
      <div className="stack">
        <input className="settings-input" placeholder="URL del script (…/exec)" value={url} onChange={(e) => setUrl(e.target.value)} />
        <input className="settings-input" type="password" placeholder="Clave secreta" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} />
        <button className="primary" disabled={busy || !url || !token} onClick={saveAndTest}>{busy ? 'Probando…' : 'Guardar y probar conexión'}</button>
        {url && <button className="ghost" onClick={disconnect}>Desconectar</button>}
      </div>
      {status && <p className="pill">{status}</p>}
    </section>
  )
}

function ShortcutSettings() {
  const base = `${location.origin}${location.pathname}`
  return (
    <details className="card">
      <summary>Apple Pay y SMS (Atajos del iPhone)</summary>
      <ol className="steps">
        <li>Atajos → Automatización → <b>Transacción</b> → tus tarjetas → Ejecutar inmediatamente.</li>
        <li>Acción <b>Abrir URLs</b> con:<br /><code>{`${base}#/applepay?monto=[Cantidad]&comercio=[Comercio]&tarjeta=[Tarjeta]`}</code></li>
        <li>Para SMS: automatización <b>Mensaje</b> del remitente del banco y la URL<br /><code>{`${base}#/alerta?texto=[Mensaje]`}</code></li>
      </ol>
      <p className="muted small" style={{ marginTop: 8 }}>
        Las partes entre corchetes son variables del atajo. Funciona cuando la app está publicada con HTTPS.
      </p>
    </details>
  )
}
