import { strFromU8, unzipSync } from 'fflate'
import { parseAmount, type ParsedAlert } from './parsers'

// Extractos mensuales de Nequi en Word (.docx). Cada tabla tiene las columnas
// Fecha del movimiento | Descripción | Valor | Saldo.

export interface StatementRow {
  date: string // YYYY-MM-DD
  description: string
  amount: number // con signo: negativo = sale plata
  balance: number
}

export interface StatementItem {
  id: string
  parsed: ParsedAlert
  own: boolean // entre tus propias cuentas: no es gasto ni ingreso
}

function decode(s: string) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&')
}

function cellText(xml: string) {
  return decode([...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('')).trim()
}

function signed(raw: string) {
  const n = parseAmount(raw)
  return /-/.test(raw) ? -n : n
}

// Lee las filas de movimientos del XML del documento.
export function rowsFromDocumentXml(xml: string): StatementRow[] {
  const rows: StatementRow[] = []
  for (const tr of xml.match(/<w:tr[\s>][\s\S]*?<\/w:tr>/g) ?? []) {
    const cells = (tr.match(/<w:tc[\s>][\s\S]*?<\/w:tc>/g) ?? []).map(cellText)
    const date = cells[0]?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
    if (cells.length !== 4 || !date) continue
    rows.push({ date: `${date[3]}-${date[2]}-${date[1]}`, description: cells[1], amount: signed(cells[2]), balance: signed(cells[3]) })
  }
  return rows
}

// Líneas de texto de un extracto en PDF: "24/08/2026 ENVIO CON BRE-B A: Nicolás $-30,000.00 $380.91".
// Si la descripción ocupa dos líneas, la segunda se pega a la anterior.
export function rowsFromStatementLines(lines: string[]): StatementRow[] {
  if (!lines.some((l) => /dep[oó]sito de bajo monto|NEQUI/i.test(l))) {
    throw new Error('Por ahora leo extractos de Nequi y Tuya. Mándame un ejemplo de este banco y lo agrego.')
  }
  const rows: StatementRow[] = []
  const re = /^(\d{2})\/(\d{2})\/(\d{4})\s+(.*?)\s*(\$\s?-?[\d,]+\.\d{2})\s+(\$\s?-?[\d,]+\.\d{2})$/
  let last: StatementRow | null = null
  for (const line of lines) {
    const m = line.match(re)
    if (m) {
      last = { date: `${m[3]}-${m[2]}-${m[1]}`, description: m[4].trim(), amount: signed(m[5]), balance: signed(m[6]) }
      rows.push(last)
    } else if (last && line.length < 60 && !/^(Fecha|P[aá]gina|Saldo|Total|Los dep[oó]sitos|\d+\s*de\s*\d+)/i.test(line) && !/\$/.test(line)) {
      // Continuación de una descripción larga.
      last.description = `${last.description} ${line}`.trim()
    } else {
      last = null
    }
  }
  return rows
}

export function readNequiDocx(file: ArrayBuffer): StatementRow[] {
  const files = unzipSync(new Uint8Array(file), { filter: (f) => f.name === 'word/document.xml' })
  const xml = files['word/document.xml']
  if (!xml) throw new Error('El archivo no parece un documento de Word.')
  const text = strFromU8(xml)
  if (!/dep[oó]sito de bajo monto|NEQUI/i.test(text)) throw new Error('No parece un extracto de Nequi.')
  return rowsFromDocumentXml(text)
}

function title(s: string) {
  return s.replace(/\s+/g, ' ').trim()
}

// Convierte una fila en un movimiento para revisar. El 4x1000 se agrupa aparte.
export function classifyNequiRow(r: StatementRow): { parsed: ParsedAlert; own: boolean } | 'gmf' {
  const d = title(r.description)
  const out = r.amount < 0
  const base = { bank: 'Nequi', role: 'movimiento' as const, amount: Math.abs(r.amount), date: r.date, account: 'Extracto' }
  if (/^GRAVAMEN/i.test(d)) return 'gmf'

  // El extracto enmascara tu propio nombre ("SIA*** LEO***") y las recargas
  // vienen de tus otras cuentas.
  if (/\*\*\*/.test(d) || /^Recarga desde/i.test(d)) {
    return { own: true, parsed: { ...base, kind: out ? 'gasto' : 'ingreso', type: out ? 'transferencia-enviada' : 'transferencia-recibida', merchant: out ? 'Envío a otra cuenta tuya' : d } }
  }
  if (/^Pago de Intereses/i.test(d)) {
    return { own: false, parsed: { ...base, kind: 'ingreso', type: 'transferencia-recibida', merchant: 'Intereses Nequi' } }
  }

  let m: RegExpMatchArray | null
  if ((m = d.match(/^PAGO EN QR BRE-B:?\s*(.*)$/i))) {
    return { own: false, parsed: { ...base, kind: 'gasto', type: 'compra', merchant: m[1] ? m[1] : 'Pago con QR' } }
  }
  if ((m = d.match(/^COMPRA PSE EN\s+(.*)$/i))) {
    return { own: false, parsed: { ...base, kind: 'gasto', type: 'pago', merchant: m[1] } }
  }
  if ((m = d.match(/^(?:ENVIO CON BRE-B A:|Para)\s+(.*)$/i))) {
    return { own: false, parsed: { ...base, kind: 'gasto', type: 'transferencia-enviada', merchant: `Transferencia a ${m[1]}` } }
  }
  if ((m = d.match(/^De\s+(.*)$/))) {
    return { own: false, parsed: { ...base, kind: 'ingreso', type: 'transferencia-recibida', merchant: m[1] } }
  }
  return { own: false, parsed: { ...base, kind: out ? 'gasto' : 'ingreso', type: out ? 'compra' : 'transferencia-recibida', merchant: d } }
}

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

export function statementItems(rows: StatementRow[]): StatementItem[] {
  const items: StatementItem[] = []
  const gmf = new Map<string, { total: number; last: string }>()
  for (const r of rows) {
    const c = classifyNequiRow(r)
    if (c === 'gmf') {
      const month = r.date.slice(0, 7)
      const g = gmf.get(month) ?? { total: 0, last: r.date }
      g.total += Math.abs(r.amount)
      if (r.date > g.last) g.last = r.date
      gmf.set(month, g)
      continue
    }
    // El saldo después del movimiento hace único el id aunque haya dos iguales el mismo día.
    items.push({ id: `extracto-nequi-${r.date}-${Math.round(r.amount * 100)}-${Math.round(r.balance * 100)}`, ...c })
  }
  for (const [month, g] of gmf) {
    items.push({
      id: `extracto-nequi-gmf-${month}`,
      own: false,
      parsed: {
        bank: 'Nequi', role: 'movimiento', kind: 'gasto', type: 'pago', account: 'Extracto',
        amount: Math.round(g.total), date: g.last, merchant: `4x1000 de ${MONTHS[Number(month.slice(5)) - 1]}`,
      },
    })
  }
  return items
}

// ── Tuya (MasterCard Carulla / Éxito) ───────────────────────────────────
// "2026/08/07 +COMPRA INTERNACIONA | CAPCUT 59.900,00 0,00 0,00 2,18% 29,62% 36/36"
// Columnas: fecha, ±descripción, valor, saldo pendiente, cuota del mes, tasa, tasa EA, cuotas.
const TUYA_ROW = /^(\d{4})\/(\d{2})\/(\d{2})\s+([+-])\s?(.+?)\s+([\d.]+,\d{2})\s+[\d.]+,\d{2}\s+[\d.]+,\d{2}\s+[\d,]+%\s+[\d,]+%\s+\d+\/\d+$/

export function tuyaItems(lines: string[]): StatementItem[] {
  const card = lines.join(' ').match(/N[uú]mero de tarjeta:?\s*\*+(\d{4})/i)?.[1] ?? ''
  const account = card ? `T. Crédito *${card}` : 'T. Crédito'
  const seen = new Map<string, number>()
  const items: StatementItem[] = []
  for (const line of lines) {
    const m = line.match(TUYA_ROW)
    if (!m) continue
    const date = `${m[1]}-${m[2]}-${m[3]}`
    const charge = m[4] === '+'
    const desc = m[5].trim()
    const amount = parseAmount(m[6])
    const merchant = desc.includes('|') ? desc.split('|').pop()!.trim() : desc
    const base = { bank: 'Tuya', role: 'movimiento' as const, amount, date, account }

    // El mismo movimiento puede salir en dos extractos (compras a cuotas):
    // el id no depende de las cuotas, solo de fecha, valor y descripción.
    const key = `${date}-${Math.round(amount)}-${desc.toUpperCase().replace(/[^A-Z0-9]+/g, '-')}`
    const n = (seen.get(key) ?? 0) + 1
    seen.set(key, n)
    const id = `extracto-tuya-${card}-${key}-${n}`

    let parsed: ParsedAlert
    let own = false
    if (charge) {
      const label = /^CUOTA DE MANEJO/i.test(desc) ? 'Cuota de manejo Tuya' : /^SEG/i.test(desc) ? 'Seguro deudores Tuya' : /^INTERES/i.test(desc) ? 'Intereses tarjeta Tuya' : merchant
      parsed = { ...base, kind: 'gasto', type: 'compra', merchant: label }
    } else if (/^PAGO/i.test(desc)) {
      // Pagar la tarjeta es pasar plata de tu cuenta a la tarjeta: no es gasto.
      own = true
      parsed = { ...base, kind: 'ingreso', type: 'transferencia-recibida', merchant: 'Pago a la tarjeta Tuya' }
    } else {
      parsed = { ...base, kind: 'ingreso', type: 'transferencia-recibida', merchant: `Ajuste o devolución Tuya` }
    }
    items.push({ id, parsed, own })
  }
  return items
}

// Decide qué banco es por el texto del PDF y devuelve sus movimientos.
export function statementFromPdfLines(lines: string[]): { bank: string; items: StatementItem[] } {
  const text = lines.join(' ')
  if (/TUYA S\.?A|tuya\.com\.co|Mastercard Carulla/i.test(text)) return { bank: 'Tuya', items: tuyaItems(lines) }
  if (/dep[oó]sito de bajo monto|NEQUI/i.test(text)) return { bank: 'Nequi', items: statementItems(rowsFromStatementLines(lines)) }
  throw new Error('Por ahora leo extractos de Nequi y Tuya. Mándame un ejemplo de este banco y lo agrego.')
}
