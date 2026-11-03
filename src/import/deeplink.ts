import { todayISO } from '../lib/format'
import { ingest, ingestParsed } from './inbox'
import { parseAmount } from './parsers'

// Atajos del iPhone abren la app con los datos en el "#" de la URL.
// Lo que va después de "#" nunca sale del teléfono hacia el servidor.
//
//   #/applepay?monto=12.000&comercio=Juan Valdez&tarjeta=Visa
//   #/alerta?texto=Bancolombia: Compraste $12.000 en ...

export async function handleDeepLink(hash = location.hash): Promise<string | null> {
  const m = hash.match(/^#\/(applepay|alerta)\?(.*)$/)
  if (!m) return null
  const params = new URLSearchParams(m[2])
  history.replaceState(null, '', location.pathname + location.search)

  if (m[1] === 'applepay') {
    const amount = parseAmount(params.get('monto') ?? '')
    const merchant = (params.get('comercio') ?? '').trim() || 'Compra Apple Pay'
    if (!amount) return 'El atajo no envió un valor.'
    const now = new Date()
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    const card = params.get('tarjeta')?.trim()
    const added = await ingestParsed(`applepay:${Date.now()}`, 'applepay', {
      bank: 'Apple Pay', role: 'movimiento', kind: 'gasto', type: 'compra',
      amount, merchant, date: todayISO(), time, account: card || undefined,
    })
    return added ? `Compra en ${merchant} lista para revisar.` : 'Esa compra ya estaba registrada.'
  }

  const text = params.get('texto') ?? ''
  const added = await ingest([{ id: `sms:${Date.now()}`, source: 'sms', text }])
  return added ? 'Alerta lista para revisar.' : 'No reconocí esa alerta o ya estaba registrada.'
}
