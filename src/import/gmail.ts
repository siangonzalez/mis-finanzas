import { getSetting, setSetting } from '../data/db'
import { ingest } from './inbox'

// Habla con el Apps Script que vive en tu propia cuenta de Google
// (ver integraciones/gmail-apps-script.gs). Ese script lee tus alertas
// bancarias y devuelve solo el texto; aquí se interpretan y se revisan.

interface ScriptResponse {
  ok: boolean
  error?: string
  messages?: { id: string; date: string; from: string; subject: string; text: string }[]
}

export async function isGmailConfigured() {
  return Boolean((await getSetting('gmail.url')) && (await getSetting('gmail.token')))
}

export async function syncGmail(days?: number) {
  const url = await getSetting('gmail.url')
  const token = await getSetting('gmail.token')
  if (!url || !token) throw new Error('Primero conecta Gmail en Ajustes.')

  const last = Number(await getSetting('gmail.lastSync')) || 0
  // La primera vez trae 60 días; después, desde la última sincronización (con un día de margen).
  const since = days ? Date.now() - days * 86_400_000 : last ? last - 86_400_000 : Date.now() - 60 * 86_400_000

  // text/plain evita la consulta previa de CORS que Apps Script no responde.
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ token, since }),
  })
  if (!res.ok) throw new Error(`Gmail respondió ${res.status}.`)
  const data = (await res.json()) as ScriptResponse
  if (!data.ok) throw new Error(data.error ?? 'El script de Gmail devolvió un error.')

  const messages = data.messages ?? []
  const added = await ingest(
    messages.map((m) => ({ id: `gmail:${m.id}`, source: 'gmail' as const, text: `${m.subject} ${m.text}`, receivedAt: Date.parse(m.date) })),
  )
  await setSetting('gmail.lastSync', String(Date.now()))
  return { read: messages.length, added }
}
