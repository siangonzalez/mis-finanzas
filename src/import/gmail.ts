import { db, getSetting, setSetting, type MailStatement } from '../data/db'
import { callScript, isScriptConfigured } from '../data/remote'
import { syncNow } from '../data/sync'
import { ingest } from './inbox'

// El Apps Script de tu cuenta de Google lee tus alertas bancarias y devuelve
// solo el texto; aquí se interpretan y quedan para revisar. También trae los
// extractos que llegan como adjunto, para leerlos en Revisar.

interface GmailResponse {
  messages?: { id: string; date: string; from: string; subject: string; text: string }[]
}

interface StatementsResponse {
  statements?: Omit<MailStatement, 'status'>[]
  more?: boolean
}

export const isGmailConfigured = isScriptConfigured

// Súbelo cuando los lectores aprendan formatos nuevos: la siguiente revisión
// vuelve a leer 60 días (lo ya revisado no se repite).
const PARSER_VERSION = 2

export async function syncGmail(days?: number) {
  // Primero lo de tus otros dispositivos, para no traer como pendiente algo
  // que ya revisaste en otro lado.
  await syncNow()
  const outdated = Number(await getSetting('gmail.parserVersion')) < PARSER_VERSION
  const last = outdated ? 0 : Number(await getSetting('gmail.lastSync')) || 0
  // La primera vez trae 60 días; después, desde la última sincronización (con un día de margen).
  const since = days ? Date.now() - days * 86_400_000 : last ? last - 86_400_000 : Date.now() - 60 * 86_400_000

  const data = await callScript<GmailResponse>('gmail', { since })
  const messages = data.messages ?? []
  const added = await ingest(
    messages.map((m) => ({ id: `gmail:${m.id}`, source: 'gmail' as const, text: `${m.subject} ${m.text}`, receivedAt: Date.parse(m.date) })),
  )
  await setSetting('gmail.lastSync', String(Date.now()))
  await setSetting('gmail.parserVersion', String(PARSER_VERSION))
  // Los extractos van aparte: si fallan, las alertas ya quedaron.
  let statements = 0
  let statementsError = ''
  try {
    statements = await fetchMailStatements()
  } catch (e) {
    statementsError = e instanceof Error ? e.message : 'No pude traer los extractos.'
  }
  return { read: messages.length, added, statements, statementsError }
}

// Extractos nuevos del correo. La primera vez busca los del último mes y
// medio; después, desde la última revisión. El script manda pocos por vez.
// Con `from` (por ejemplo, el 1 de enero) trae también los viejos.
export async function fetchMailStatements(from?: number) {
  const since = from ?? (Number(await getSetting('extractos.since')) || Date.now() - 45 * 86_400_000)
  const start = Date.now()
  let added = 0
  for (let round = 0; round < (from ? 20 : 5); round++) {
    const seen = (await db.extractos.toArray()).map((s) => s.id)
    let data: StatementsResponse
    try {
      data = await callScript<StatementsResponse>('extractos', { since, seen })
    } catch (e) {
      if (e instanceof Error && /versión vieja/.test(e.message)) {
        throw new Error('Para traer los extractos del correo, actualiza tu script de Google con el código nuevo (integraciones/README.md).')
      }
      throw e
    }
    const fresh = (data.statements ?? []).filter((s) => !seen.includes(s.id))
    await db.extractos.bulkPut(fresh.map((s) => ({ ...s, status: 'pendiente' as const })))
    added += fresh.length
    if (!data.more || !fresh.length) {
      // Dos días de margen por si un correo llega con fecha atrasada.
      await setSetting('extractos.since', String(start - 2 * 86_400_000))
      break
    }
  }
  return added
}

// Al abrir la app, revisa el correo si hace más de 3 horas que no lo hace.
export async function autoSyncGmail() {
  if (!(await isScriptConfigured())) return
  if (Date.now() - (Number(await getSetting('gmail.lastSync')) || 0) < 3 * 3_600_000) return
  try {
    await syncGmail()
  } catch {
    /* sin conexión o con el script desactualizado: queda el botón de Revisar */
  }
}

export function statementFiles(s: MailStatement) {
  return s.files.map((f) => new File([Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0))], f.name, { type: f.mime }))
}
