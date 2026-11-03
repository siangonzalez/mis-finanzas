import type { Kind } from '../data/categories'

// Lee el texto de una alerta bancaria (correo o SMS) y saca el movimiento.
// Los formatos salen de alertas reales de Bancolombia, Nequi, PSE y Davivienda.

export type AlertRole =
  | 'movimiento' // la cuenta de donde sale o entra la plata (Bancolombia, Nequi)
  | 'comprobante' // recibo del comercio o de PSE; suele repetir un movimiento

export interface ParsedAlert {
  bank: string
  role: AlertRole
  kind: Kind
  amount: number
  merchant: string
  date: string // YYYY-MM-DD
  time?: string // HH:MM
  account?: string
  type: 'compra' | 'retiro' | 'pago' | 'transferencia-recibida' | 'transferencia-enviada'
}

// "$527000.00", "$100,000.00", "$6.057,00", "$ 28.540,28", "$28.900", "$ 527,000.00 COP"
export function parseAmount(raw: string): number {
  const s = raw.replace(/[^\d.,]/g, '')
  if (!s) return 0
  const decimal = s.match(/[.,](\d{1,2})$/)
  const intPart = decimal ? s.slice(0, -decimal[0].length) : s
  const n = Number(intPart.replace(/[.,]/g, '')) + (decimal ? Number(`0.${decimal[1]}`) : 0)
  return Math.round(n)
}

const MONTHS: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
}

// "29/10/2026" o "22/10/26"
function dmy(d: string, m: string, y: string) {
  const year = y.length === 2 ? `20${y}` : y
  return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}

function clean(s: string) {
  return s.replace(/\s+/g, ' ').trim()
}

const AMOUNT = String.raw`\$\s?([\d.,]+)`
const DATE = String.raw`(\d{1,2})\/(\d{1,2})\/(\d{2,4})`

type Parser = (t: string) => ParsedAlert | null

const bancolombia: Parser[] = [
  (t) => {
    const m = t.match(new RegExp(`Compraste ${AMOUNT} en (.+?) con tu (T\\.?\\s?(?:Deb|Cred)[^,]*?)\\*+(\\d{4}),? el ${DATE} a las (\\d{1,2}:\\d{2})`, 'i'))
    if (!m) return null
    return {
      bank: 'Bancolombia', role: 'movimiento', kind: 'gasto', type: 'compra',
      amount: parseAmount(m[1]), merchant: clean(m[2]),
      account: `${/cred/i.test(m[3]) ? 'T. Crédito' : 'T. Débito'} *${m[4]}`,
      date: dmy(m[5], m[6], m[7]), time: m[8],
    }
  },
  (t) => {
    const m = t.match(new RegExp(`Retiraste ${AMOUNT} en (.+?) de tu .*?\\*+(\\d{4}),? el ${DATE} a las (\\d{1,2}:\\d{2})`, 'i'))
    if (!m) return null
    return {
      bank: 'Bancolombia', role: 'movimiento', kind: 'gasto', type: 'retiro',
      amount: parseAmount(m[1]), merchant: `Retiro ${clean(m[2])}`, account: `*${m[3]}`,
      date: dmy(m[4], m[5], m[6]), time: m[7],
    }
  },
  (t) => {
    const m = t.match(new RegExp(`Pagaste ${AMOUNT} a (.+?) desde tu producto \\*?(\\d{4}),? el ${DATE},? (?:a las )?(\\d{1,2}:\\d{2})`, 'i'))
    if (!m) return null
    return {
      bank: 'Bancolombia', role: 'movimiento', kind: 'gasto', type: 'pago',
      amount: parseAmount(m[1]), merchant: clean(m[2]), account: `*${m[3]}`,
      date: dmy(m[4], m[5], m[6]), time: m[7],
    }
  },
  (t) => {
    const m = t.match(new RegExp(`recibiste una transferencia de (.+?) por ${AMOUNT} en tu cuenta \\*?(\\d{4}).*? el ${DATE} a las (\\d{1,2}:\\d{2})`, 'i'))
    if (!m) return null
    return {
      bank: 'Bancolombia', role: 'movimiento', kind: 'ingreso', type: 'transferencia-recibida',
      amount: parseAmount(m[2]), merchant: clean(m[1]), account: `*${m[3]}`,
      date: dmy(m[4], m[5], m[6]), time: m[7],
    }
  },
  (t) => {
    // "Transferiste $X desde tu cuenta *1234 a la cuenta *5678 el 01/11/2026 a las 10:00"
    const m = t.match(new RegExp(`Transferiste ${AMOUNT} (?:desde tu cuenta \\*?(\\d{4}) )?a (.+?),? el ${DATE}(?: a las)? (\\d{1,2}:\\d{2})`, 'i'))
    if (!m) return null
    return {
      bank: 'Bancolombia', role: 'movimiento', kind: 'gasto', type: 'transferencia-enviada',
      amount: parseAmount(m[1]), merchant: `Transferencia a ${clean(m[3])}`, account: m[2] ? `*${m[2]}` : undefined,
      date: dmy(m[4], m[5], m[6]), time: m[7],
    }
  },
]

const nequi: Parser = (t) => {
  const m = t.match(/Hiciste un pago en (.+?) por \$\s?([\d.,]+).*?El (\d{1,2}) de (\w+) de (\d{4})(?:\s*Hora:\s*(\d{1,2}:\d{2})\s*([ap])\.?\s?m)?/i)
  if (!m) return null
  const month = MONTHS[m[4].toLowerCase()]
  if (!month) return null
  let time: string | undefined
  if (m[6]) {
    let [h, min] = m[6].split(':').map(Number)
    if (m[7].toLowerCase() === 'p' && h < 12) h += 12
    if (m[7].toLowerCase() === 'a' && h === 12) h = 0
    time = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
  }
  return {
    bank: 'Nequi', role: 'movimiento', kind: 'gasto', type: 'pago',
    amount: parseAmount(m[2]), merchant: clean(m[1]),
    date: `${m[5]}-${String(month).padStart(2, '0')}-${m[3].padStart(2, '0')}`, time,
  }
}

const pse: Parser = (t) => {
  if (!/Protegido ACH|PSE - Transacci[oó]n Aprobada|serviciopse/i.test(t)) return null
  const amount = t.match(/Valor:?\s*\|?\s*\$\s?([\d.,]+)/i)
  const company = t.match(/Empresa:?\s*\|?\s*(.+?)\s*\|?\s*Descripci[oó]n/i)
  const date = t.match(new RegExp(`Fecha de la transacci[oó]n:?\\s*\\|?\\s*${DATE}`, 'i'))
  if (!amount || !date) return null
  return {
    bank: 'PSE', role: 'comprobante', kind: 'gasto', type: 'pago',
    amount: parseAmount(amount[1]), merchant: clean(company?.[1] ?? 'Pago PSE').replace(/\|/g, '').trim(),
    date: dmy(date[1], date[2], date[3]),
  }
}

const davivienda: Parser = (t) => {
  if (!/su pago ha sido exitoso/i.test(t)) return null
  const amount = t.match(/Valor total:\s*\$\s?([\d.,]+)/i)
  const date = t.match(new RegExp(`Fecha y hora transacci[oó]n:\\s*${DATE}\\s*(\\d{1,2}:\\d{2})?`, 'i'))
  const company = t.match(/####\s*(Davivienda[^#]*?)\s*Direcci[oó]n/i)
  if (!amount || !date) return null
  return {
    bank: 'Davivienda', role: 'comprobante', kind: 'gasto', type: 'pago',
    amount: parseAmount(amount[1]), merchant: clean(company?.[1] ?? 'Pago Davivienda'),
    date: dmy(date[1], date[2], date[3]), time: date[4],
  }
}

const PARSERS: Parser[] = [...bancolombia, nequi, pse, davivienda]

export function parseAlert(text: string): ParsedAlert | null {
  const t = clean(text)
  for (const p of PARSERS) {
    const r = p(t)
    if (r && r.amount > 0) return r
  }
  return null
}
