import { db, setSetting, type Debt } from './db'
import { callScript, isScriptConfigured } from './remote'

// La hoja "Mis finanzas – Deudas" de tu Google Drive es la fuente de verdad
// de las deudas. La app guarda una copia para funcionar sin conexión:
//   1. sube lo que se hizo aquí y aún no está en la hoja,
//   2. trae la versión de la hoja y reemplaza la copia local.
// Una tarea programada de Claude copia los pagos entre la hoja y el tablero
// que compartes con la otra persona.

type RemoteDebt = Omit<Debt, 'pendingUpload'>

export interface SyncResult {
  ok: boolean
  message: string
  sheetUrl?: string
}

let running: Promise<SyncResult> | null = null

export function syncDebts(): Promise<SyncResult> {
  // Evita dos sincronizaciones al tiempo (por ejemplo, al abrir la pestaña y guardar un pago).
  running ??= doSync().finally(() => (running = null))
  return running
}

function clean(d: Debt): RemoteDebt {
  const { pendingUpload: _p, ...rest } = d
  return { ...rest, payments: rest.payments.map(({ pending: _x, ...p }) => p) }
}

async function doSync(): Promise<SyncResult> {
  if (!(await isScriptConfigured())) return { ok: false, message: 'Conecta tu cuenta de Google en Ajustes para guardar la deuda en la nube.' }
  try {
    const local = await db.debts.toArray()
    const before = await callScript<{ debts: RemoteDebt[]; sheetUrl: string }>('debts.get')
    const remoteIds = new Set(before.debts.map((d) => d.id))

    let uploaded = 0
    for (const d of local) {
      if (d.pendingUpload || !remoteIds.has(d.id)) {
        await callScript('debts.put', { debt: clean(d) })
        uploaded++
        continue
      }
      for (const p of d.payments.filter((x) => x.pending)) {
        const { pending: _x, ...payment } = p
        await callScript('debts.addPayment', { debtId: d.id, payment })
        uploaded++
      }
    }

    const after = uploaded ? await callScript<{ debts: RemoteDebt[]; sheetUrl: string }>('debts.get') : before
    await db.transaction('rw', db.debts, async () => {
      await db.debts.clear()
      await db.debts.bulkPut(after.debts)
    })
    await setSetting('debts.lastSync', String(Date.now()))
    await setSetting('debts.sheetUrl', after.sheetUrl)
    return { ok: true, message: uploaded ? `Sincronizado: subí ${uploaded} cambio${uploaded > 1 ? 's' : ''} a la hoja.` : 'Al día con la hoja de Google.', sheetUrl: after.sheetUrl }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'No se pudo sincronizar.' }
  }
}
