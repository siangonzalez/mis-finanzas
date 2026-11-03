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

  if (/\/dev(\?|$)/.test(url)) {
    throw new Error('Esa es la URL de prueba (termina en /dev). Usa la de "Implementar → Nueva implementación", que termina en /exec.')
  }

  // text/plain evita la consulta previa de CORS que Apps Script no responde.
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token, action, ...payload }),
    })
  } catch {
    // "Failed to fetch" / "Load failed": casi siempre Google pidió iniciar
    // sesión porque la implementación no está abierta a "Cualquier usuario".
    throw new Error(
      'No pude comunicarme con el script. En script.google.com revisa Implementar → Gestionar implementaciones: tipo "Aplicación web", ejecutar como "Yo" y acceso "Cualquier usuario". Si cambias algo, crea una nueva versión.',
    )
  }
  if (!res.ok) throw new Error(`Google respondió ${res.status}. Revisa que la URL sea la de la implementación (termina en /exec).`)
  let data: { ok: boolean; error?: string } & T
  try {
    data = await res.json()
  } catch {
    throw new Error('El script respondió algo que no es de esta app. Revisa que pegaste todo el código y creaste una nueva versión.')
  }
  if (!data.ok) {
    if (/Acción desconocida/.test(data.error ?? '')) {
      throw new Error('Tu script de Google es una versión vieja. Actualízalo con el código nuevo (integraciones/README.md).')
    }
    throw new Error(data.error ?? 'El script de Google devolvió un error.')
  }
  return data
}
