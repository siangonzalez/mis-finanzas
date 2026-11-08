import type { InboxItem, Receivable } from '../data/db'

// Cuentas de cobro: encontrar en tus alertas el pago que corresponde a cada una.
// Un pago de honorarios suele llegar con la retención en la fuente descontada
// (10 u 11 %), así que se acepta desde el 85 % del valor cobrado.
// La app solo propone: tú confirmas que ese ingreso es el pago del cobro.

const MIN_SHARE = 0.85

// Lo que te han abonado y lo que todavía te deben de una cuenta de cobro.
export const received = (r: Pick<Receivable, 'payments'>) => (r.payments ?? []).reduce((s, p) => s + p.amount, 0)
export const remaining = (r: Pick<Receivable, 'amount' | 'payments' | 'paid'>) => (r.paid ? 0 : Math.max(0, r.amount - received(r)))
const norm = (s: string) => s.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

// Palabras que no identifican a nadie en una alerta del banco.
const GENERIC = new Set(['UNIVERSIDAD', 'GROUP', 'GRUPO', 'EMPRESA', 'INMOBILIARIA', 'COMPANY', 'COLOMBIA', 'SERVICIOS', 'FUNDACION', 'CORPORACION'])

// Con los nombres que diste para las alertas basta uno; si no diste ninguno,
// deben aparecer todas las palabras propias del cliente ("Sergio Arboleda",
// no solo "Sergio").
export function nameMatches(r: Pick<Receivable, 'client' | 'keywords'>, merchant: string) {
  const m = norm(merchant)
  if (r.keywords.length) return r.keywords.some((k) => k.trim().length >= 3 && m.includes(norm(k.trim())))
  const words = norm(r.client).split(/[^A-Z0-9]+/).filter((w) => w.length >= 4 && !GENERIC.has(w))
  return words.length > 0 && words.every((w) => m.includes(w))
}

// Ingresos que podrían ser el pago de este cobro, el más probable primero.
// usedIds: ingresos ya asignados a otro cobro.
export function paymentCandidates(r: Receivable, inbox: InboxItem[], usedIds: Set<string> = new Set()) {
  if (r.paid) return []
  // Si ya te abonaron una parte, se busca lo que falta.
  const due = remaining(r)
  if (due <= 0) return []
  const abonos = new Set((r.payments ?? []).map((p) => p.inboxId).filter(Boolean))
  return inbox
    .filter(
      (i) =>
        i.kind === 'ingreso' &&
        (i.status === 'pendiente' || i.status === 'aceptado') &&
        i.date >= r.sentDate &&
        i.amount >= due * MIN_SHARE &&
        i.amount <= due * 1.005 &&
        !usedIds.has(i.id) &&
        !abonos.has(i.id) &&
        !r.rejected?.includes(i.id),
    )
    .map((i) => ({ item: i, byName: nameMatches(r, i.merchant), exact: Math.abs(i.amount - due) <= due * 0.005 }))
    // Sin el nombre del cliente, solo vale un valor exacto (un ingreso cualquiera del 90 % sería adivinar).
    .filter((c) => c.byName || c.exact)
    .sort((a, b) => Number(b.byName) - Number(a.byName) || Number(b.exact) - Number(a.exact) || a.item.date.localeCompare(b.item.date))
}

// Para cada cobro pendiente, el pago propuesto; un mismo ingreso se propone para un solo cobro.
export function proposedPayments(list: Receivable[], inbox: InboxItem[]) {
  const used = new Set(list.flatMap((r) => [r.paid?.inboxId, ...(r.payments ?? []).map((p) => p.inboxId)]).filter((x): x is string => Boolean(x)))
  const out = new Map<string, InboxItem>()
  for (const r of [...list].sort((a, b) => a.sentDate.localeCompare(b.sentDate))) {
    const best = paymentCandidates(r, inbox, used)[0]
    if (best) {
      out.set(r.id, best.item)
      used.add(best.item.id)
    }
  }
  return out
}

export function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)
}
