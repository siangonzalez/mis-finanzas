import { asRemote, db, getSetting, onLocalChange, setSetting, SYNCED_TABLES, type Synced, type SyncedTable } from './db'
import { callScript, isScriptConfigured } from './remote'

// Sincroniza movimientos, bandeja, presupuesto, reglas y tarjetas entre tus
// dispositivos, a través de la pestaña "datos" de tu hoja de Google.
//  1. Manda lo que cambió aquí desde la última vez.
//  2. Recibe lo que cambió en tus otros dispositivos y lo aplica.
// Si el mismo registro cambió en los dos lados, gana el cambio más reciente.

type Rec = Synced & { id: string }

interface SyncResponse {
  now: number
  changes: { table: SyncedTable; rec: Rec }[]
}

export interface SyncState {
  ok: boolean
  message: string
  sent?: number
  received?: number
}

let running: Promise<SyncState> | null = null
let again: Promise<SyncState> | null = null

// Si ya hay una sincronización en curso, se hace otra justo después, para no
// perder lo que cambió mientras tanto.
export function syncNow(): Promise<SyncState> {
  if (!running) {
    running = run().finally(() => (running = null))
    return running
  }
  again ??= running.then(() => {
    again = null
    return syncNow()
  })
  return again
}

async function run(): Promise<SyncState> {
  if (!(await isScriptConfigured())) return { ok: false, message: 'Conecta tu cuenta de Google en Ajustes para sincronizar tus dispositivos.' }

  const since = Number(await getSetting('sync.since')) || 0
  const pushedUntil = Number(await getSetting('sync.pushed')) || 0
  const start = Date.now()

  const changes: { table: SyncedTable; rec: Rec }[] = []
  for (const table of SYNCED_TABLES) {
    const recs = (await db.table(table).where('updatedAt').above(pushedUntil).toArray()) as Rec[]
    for (const rec of recs) changes.push({ table, rec })
  }

  try {
    const res = await callScript<SyncResponse>('data.sync', { since, changes })
    let received = 0
    await asRemote(() =>
      db.transaction('rw', SYNCED_TABLES.map((t) => db.table(t)), async () => {
        for (const c of res.changes) {
          if (!SYNCED_TABLES.includes(c.table)) continue
          const table = db.table(c.table)
          const local = (await table.get(c.rec.id)) as Rec | undefined
          if (!local || (c.rec.updatedAt ?? 0) > (local.updatedAt ?? 0)) {
            await table.put(c.rec)
            received++
          }
        }
      }),
    )
    await setSetting('sync.since', String(res.now))
    await setSetting('sync.pushed', String(start))
    await setSetting('sync.at', String(Date.now()))
    return {
      ok: true,
      sent: changes.length,
      received,
      message: received || changes.length ? `Sincronizado: ${changes.length} enviados, ${received} recibidos.` : 'Todo al día en tus dispositivos.',
    }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'No se pudo sincronizar.' }
  }
}

// Sincroniza al abrir, al volver a la app y unos segundos después de cada cambio.
export function startAutoSync() {
  let timer: ReturnType<typeof setTimeout> | undefined
  const soon = () => {
    clearTimeout(timer)
    timer = setTimeout(() => void syncNow(), 4000)
  }
  const onVisible = () => {
    if (document.visibilityState === 'visible') void syncNow()
  }
  const stop = onLocalChange(soon)
  document.addEventListener('visibilitychange', onVisible)
  void syncNow()
  return () => {
    stop()
    clearTimeout(timer)
    document.removeEventListener('visibilitychange', onVisible)
  }
}
