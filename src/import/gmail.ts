import { getSetting, setSetting } from '../data/db'
import { callScript, isScriptConfigured } from '../data/remote'
import { ingest } from './inbox'

// El Apps Script de tu cuenta de Google lee tus alertas bancarias y devuelve
// solo el texto; aquí se interpretan y quedan para revisar.

interface GmailResponse {
  messages?: { id: string; date: string; from: string; subject: string; text: string }[]
}

export const isGmailConfigured = isScriptConfigured

export async function syncGmail(days?: number) {
  const last = Number(await getSetting('gmail.lastSync')) || 0
  // La primera vez trae 60 días; después, desde la última sincronización (con un día de margen).
  const since = days ? Date.now() - days * 86_400_000 : last ? last - 86_400_000 : Date.now() - 60 * 86_400_000

  const data = await callScript<GmailResponse>('gmail', { since })
  const messages = data.messages ?? []
  const added = await ingest(
    messages.map((m) => ({ id: `gmail:${m.id}`, source: 'gmail' as const, text: `${m.subject} ${m.text}`, receivedAt: Date.parse(m.date) })),
  )
  await setSetting('gmail.lastSync', String(Date.now()))
  return { read: messages.length, added }
}
