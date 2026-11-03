import { getSetting } from './db'

// Todas las llamadas al Apps Script de tu cuenta de Google pasan por aquí
// (ver integraciones/gmail-apps-script.gs).

export async function isScriptConfigured() {
  return Boolean((await getSetting('gmail.url')) && (await getSetting('gmail.token')))
}

export async function callScript<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const url = await getSetting('gmail.url')
  const token = await getSetting('gmail.token')
  if (!url || !token) throw new Error('Primero conecta tu cuenta de Google en Ajustes.')

  // text/plain evita la consulta previa de CORS que Apps Script no responde.
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ token, action, ...payload }),
  })
  if (!res.ok) throw new Error(`Google respondió ${res.status}.`)
  const data = (await res.json()) as { ok: boolean; error?: string } & T
  if (!data.ok) {
    if (/Acción desconocida/.test(data.error ?? '')) {
      throw new Error('Tu script de Google es una versión vieja. Actualízalo con el código nuevo (integraciones/README.md).')
    }
    throw new Error(data.error ?? 'El script de Google devolvió un error.')
  }
  return data
}
