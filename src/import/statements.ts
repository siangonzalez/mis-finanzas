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
    throw new Error('Por ahora leo extractos de Nequi, Tuya, las tarjetas Bancolombia, la cuenta de ahorros Bancolombia, el crédito, la cuenta de ahorros y la tarjeta Davivienda y la Cuenta Nu sin movimientos. Mándame un ejemplo de este banco y lo agrego.')
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
    return { own: true, parsed: { ...base, kind: out ? 'gasto' : 'ingreso', type: out ? 'transferencia-enviada' : 'transferencia-recibida', merchant: out ? 'Envío a otra de tus cuentas' : d } }
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
    if (charge && /AVANCE/i.test(desc)) {
      // Un avance pasa plata de la tarjeta a tu cuenta: es deuda, no gasto.
      own = true
      parsed = { ...base, kind: 'gasto', type: 'transferencia-enviada', merchant: 'Avance de la tarjeta Tuya' }
    } else if (charge) {
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

// ── Tarjetas de crédito Bancolombia (MasterCard, AMEX, Visa) ─────────────
// "C03247 14/10/2026 AVANCE SUCURSAL VIRTUAL $ 2.000.000,00 1/24 $ 83.333,33 2,1155 % 28,5582 % $ 1.916.666,67"
// "000000 15/10/2026 CUOTA DE MANEJO $ 36.990,00 $ 36.990,00 $ 0,00"
// Columnas: autorización (opcional), fecha, descripción, valor, cuotas (opcional),
// cuota o abono, tasas (opcional), saldo pendiente.
const BANCOLOMBIA_ROW = /^(?:\S{6}\s+)?(\d{2})\/(\d{2})\/(\d{4})\s+(.+?)\s+\$\s?(-?[\d.]+,\d{2})(?:\s+\d+\/\d+)?\s+\$\s?-?[\d.]+,\d{2}(?:\s+[\d,]+\s?%\s+[\d,]+\s?%)?\s+\$\s?-?[\d.]+,\d{2}$/

export function bancolombiaCardItems(lines: string[]): StatementItem[] {
  const card = lines.join(' ').match(/Tarjeta:\s*\*+(\d{4})/)?.[1] ?? ''
  const account = card ? `T. Crédito *${card}` : 'T. Crédito'
  const items: StatementItem[] = []
  const seen = new Map<string, number>()
  let pesos = false // las páginas en dólares van aparte
  let fresh = false // solo "Nuevos movimientos"; los anteriores ya salieron en su extracto
  for (const line of lines) {
    const currency = line.match(/ESTADO DE CUENTA EN:\s*(PESOS|DOLARES)/i)
    if (currency) {
      pesos = /PESOS/i.test(currency[1])
      fresh = false
    }
    if (/Nuevos movimientos entre/i.test(line)) fresh = true
    if (/Movimientos antes de/i.test(line)) fresh = false
    const m = pesos && fresh ? line.match(BANCOLOMBIA_ROW) : null
    if (!m) continue

    const date = `${m[3]}-${m[2]}-${m[1]}`
    const desc = m[4].trim()
    const value = signed(m[5])
    const amount = Math.abs(value)
    const key = `${date}-${Math.round(amount)}-${desc.toUpperCase().replace(/[^A-Z0-9]+/g, '-')}`
    const n = (seen.get(key) ?? 0) + 1
    seen.set(key, n)
    // "Bancolombia TC" para no confundir la tarjeta con tu cuenta Bancolombia al
    // emparejar el pago de la tarjeta con la plata que sale de la cuenta.
    const base = { bank: 'Bancolombia TC', role: 'movimiento' as const, amount, date, account }

    let parsed: ParsedAlert
    let own = false
    if (value < 0 || /^(ABONO|PAGO)/i.test(desc)) {
      own = true
      parsed = { ...base, kind: 'ingreso', type: 'transferencia-recibida', merchant: 'Pago a la tarjeta Bancolombia' }
    } else if (/^AVANCE/i.test(desc)) {
      // Un avance pasa plata de la tarjeta a tu cuenta: es deuda, no gasto.
      own = true
      parsed = { ...base, kind: 'gasto', type: 'transferencia-enviada', merchant: 'Avance de la tarjeta Bancolombia' }
    } else {
      const label = /^INTERESES/i.test(desc) ? 'Intereses tarjeta Bancolombia'
        : /^CUOTA DE MANEJO/i.test(desc) ? 'Cuota de manejo Bancolombia'
        : /^COMISION/i.test(desc) ? 'Comisión tarjeta Bancolombia'
        : desc
      parsed = { ...base, kind: 'gasto', type: 'compra', merchant: label }
    }
    items.push({ id: `extracto-bancolombia-${card}-${key}-${n}`, parsed, own })
  }
  return items
}

// ── Resumen de la tarjeta: cuánto debes y cuándo pagar ─────────────────
export interface CardSummary {
  id: string // `${banco}-${últimos 4}`
  bank: string
  last4: string
  cutDate: string // fecha de corte del extracto
  dueDate: string // pagar antes de ('' si no hay nada que pagar)
  totalDebt: number
  minPayment: number
  limit: number
  available: number
  ea: number // tasa efectiva anual más alta del extracto (0,2856 = 28,56 %)
  kind?: 'tarjeta' | 'prestamo' // sin valor = tarjeta
  installmentsLeft?: number // préstamos: cuotas que faltan, contando la que vence
}

const MONTH_ABBR: Record<string, number> = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12 }

function isoFrom(day: string, mon: string, year: string) {
  const m = MONTH_ABBR[mon.toLowerCase().slice(0, 3)]
  return m ? `${year}-${String(m).padStart(2, '0')}-${day.padStart(2, '0')}` : ''
}

function maxEA(lines: string[]) {
  let ea = 0
  for (const l of lines) {
    const m = l.match(/([\d.,]+)\s?%\s+([\d.,]+)\s?%\s*$/)
    if (m) ea = Math.max(ea, Number(m[2].replace(',', '.')) / 100)
  }
  return ea
}

// Tuya, primera página: "05-oct-2026 $48.566,94 $168.159,03" (fecha límite, mínimo, total),
// y en otras líneas "Fecha de Corte: 09-sep-2026", "Cupo Total: $8.600.000", "Cupo Disponible: …".
export function tuyaSummary(lines: string[]): CardSummary | null {
  const last4 = lines.join(' ').match(/N[uú]mero de tarjeta:?\s*\*+(\d{4})/i)?.[1] ?? ''
  const i = lines.findIndex((l) => /^\d{2}-\w{3}-\d{4}\s+\$[\d.]+,\d{2}\s+\$[\d.]+,\d{2}$/.test(l))
  if (i < 0) return null
  const head = lines[i].match(/^(\d{2})-(\w{3})-(\d{4})\s+\$([\d.]+,\d{2})\s+\$([\d.]+,\d{2})$/)!
  const all = lines.join(' ')
  const cut = all.match(/Fecha de Corte:?\s*(\d{2})-(\w{3})-(\d{4})/i)
  const money = (re: RegExp) => parseAmount(all.match(re)?.[1] ?? '0')
  return {
    id: `tuya-${last4}`, bank: 'Tuya', last4,
    dueDate: isoFrom(head[1], head[2], head[3]),
    cutDate: cut ? isoFrom(cut[1], cut[2], cut[3]) : '',
    minPayment: parseAmount(head[4]), totalDebt: parseAmount(head[5]),
    limit: money(/Cupo Total:?\s*\$([\d.]+)/i), available: money(/Cupo Disponible:?\s*\$([\d.]+)/i),
    ea: maxEA(lines.filter((l) => /^Compras\s/.test(l))),
  }
}

// Bancolombia, página en pesos: "15 sep - 15 oct. 2026 $ 7.556.731,00 …" (periodo y pago total),
// "nov. 03, 2026 … $ 538.898,00 …" (pagar antes de y mínimo), "Cupo total: $ …", "Disponible: $ …".
export function bancolombiaSummary(lines: string[]): CardSummary | null {
  const last4 = lines.join(' ').match(/Tarjeta:\s*\*+(\d{4})/)?.[1] ?? ''
  const start = lines.findIndex((l) => /Moneda:\s*PESOS/i.test(l))
  if (start < 0) return null
  const end = lines.findIndex((l, k) => k > start && /Detalles del movimiento/i.test(l))
  const sec = lines.slice(start, end < 0 ? undefined : end)
  const period = sec.map((l) => l.match(/^\d{1,2} \w{3}\.? - (\d{1,2}) (\w{3})\.? (\d{4}) \$ ([\d.]+,\d{2})/)).find(Boolean)
  const due = sec.map((l) => l.match(/^(\w{3})\.? (\d{2}), (\d{4}).*?\$ ([\d.]+,\d{2})/)).find(Boolean)
  const amount = (re: RegExp) => parseAmount(sec.join(' ').match(re)?.[1] ?? '0')
  return {
    id: `bancolombia-${last4}`, bank: 'Bancolombia', last4,
    cutDate: period ? isoFrom(period[1], period[2], period[3]) : '',
    totalDebt: period ? parseAmount(period[4]) : 0,
    dueDate: due ? isoFrom(due[2], due[1], due[3]) : '',
    minPayment: due ? parseAmount(due[4]) : 0,
    limit: amount(/Cupo total:\s*\$\s?([\d.]+,\d{2})/),
    available: amount(/Disponible:\s*\$\s?([\d.]+,\d{2})/),
    ea: maxEA(sec),
  }
}

// Davivienda, "Extracto Crédito" (préstamos de libre inversión y similares):
// "Páguese antes del Nov. 03/2026", "+ Valor Cuota Mes $527,000.00", "No. Cuotas Pdtes. Pago Total 17",
// "Tasa Interés Cte.Cobrada Periodo 20.12% E.A", "Saldo a: Sep. 30/2026 $ 7,944,160.34".
export function daviviendaLoanSummary(lines: string[]): CardSummary | null {
  const all = lines.join(' ')
  const number = all.match(/No del cr[eé]dito:?\s*([\d-]+)/i)?.[1].replace(/\D/g, '') ?? ''
  const last4 = number.slice(-4)
  const due = all.match(/P[aá]guese antes del\s+(\w{3})\.?\s+(\d{1,2})\/(\d{4})/i)
  const balance = all.match(/Saldo a:?\s+(\w{3})\.?\s+(\d{1,2})\/(\d{4})\s+\$\s?([\d,]+\.\d{2})/i)
  const total = all.match(/Total Valor a Pagar\s+\$\s?([\d,]+\.\d{2})/i)
  if (!balance || !total) return null
  const ea = all.match(/Tasa\s+Inter[eé]s Cte\.?\s*Cobrada Periodo\s+([\d.]+)\s?%/i) ?? all.match(/([\d.]+)\s?%\s+E\.A/i)
  const left = all.match(/Cuotas Pdtes\.? Pago Total\s+(\d+)/i)
  return {
    id: `davivienda-credito-${last4}`, bank: 'Davivienda', last4, kind: 'prestamo',
    cutDate: isoFrom(balance[2], balance[1], balance[3]),
    dueDate: due ? isoFrom(due[2], due[1], due[3]) : '',
    totalDebt: parseAmount(balance[4]),
    minPayment: parseAmount(total[1]),
    limit: 0, available: 0,
    ea: ea ? Number(ea[1]) / 100 : 0,
    installmentsLeft: left ? Number(left[1]) : undefined,
  }
}

// Decide qué banco es por el texto del PDF y devuelve sus movimientos.
// ── Cuenta de ahorros Bancolombia ─────────────────────────────────────────
// "1/07 COMPRA EN AUTOBOY AU -86,000.00 579,450.26"
// Columnas: día/mes, descripción (con sucursal y documento), valor con signo
// y saldo, con coma para miles y punto decimal. El periodo puede ser de varios meses.
const BANCOLOMBIA_SAVINGS_ROW = /^(\d{1,2})\/(\d{2})\s+(.+?)\s+(-?[\d,]*\.\d{2})\s+(-?[\d,]*\.\d{2})$/

// Entre tus cuentas: Nequi, pagos y avances de tus tarjetas, y pagos a Tuya y Davivienda.
const BANCOLOMBIA_OWN = /^(TRANSFERENCIAS A NEQUI|TRANSFERENCIA DESDE NEQUI|PAGO (AUTOM|SUC VIRT) TC|DEVOLUCION ABONO TC|TRANSFERENCIA TC SUC VIRTUAL|PAGO PSE (Compania de Financ|Banco Davivienda|Davivienda\b))/i

function bancolombiaMerchant(desc: string, credit: boolean) {
  const d = desc.replace(/\s+/g, ' ').trim()
  if (/^C MANEJO TARJ DEB/i.test(d)) return 'Cuota de manejo tarjeta débito Bancolombia'
  if (/^(COMIS|IVA COMIS)/i.test(d)) return `Comisión Bancolombia (${d.toLowerCase()})`
  const to = d.match(/^TRANSF A (.+)$/i)
  if (to) return `Transferencia a ${to[1]}`
  const stripped = d.replace(/^(COMPRA EN|COMPRA INTL|PAGO QR|PAGO LLAVE|PAGO PSE|TRANSF DE|PAGO INTERBANC|PAGO DE PROV)\s+/i, '')
  return stripped || (credit ? 'Ingreso Bancolombia' : 'Gasto Bancolombia')
}

export function bancolombiaSavings(lines: string[]): { bank: string; items: StatementItem[]; note: string } {
  const text = lines.join(' ')
  const period = text.match(/DESDE:\s*(\d{4})\/(\d{2})\/\d{2}\s+HASTA:\s*(\d{4})\/(\d{2})\/(\d{2})/i)
  const [startYear, startMonth, endYear] = period ? [Number(period[1]), Number(period[2]), Number(period[3])] : [0, 0, new Date().getFullYear()]
  const last4 = text.match(/N[ÚU]MERO\s+(\d{6,})/i)?.[1].slice(-4) ?? ''
  const account = last4 ? `*${last4}` : 'Ahorros'
  const seen = new Map<string, number>()
  const items: StatementItem[] = []
  for (const line of lines) {
    const m = line.match(BANCOLOMBIA_SAVINGS_ROW)
    if (!m) continue
    const desc = m[3].trim()
    // Los intereses de la cuenta son de centavos o pocos pesos al día: no se anotan.
    if (/INTERES/i.test(desc)) continue
    const value = parseAmount(m[4])
    if (value < 1) continue
    const month = Number(m[2])
    // Un extracto de diciembre a febrero tiene meses de dos años.
    const year = startYear && startYear < endYear && month >= startMonth ? startYear : endYear
    const date = `${year}-${m[2]}-${m[1].padStart(2, '0')}`
    const credit = !m[4].startsWith('-')
    const merchant = bancolombiaMerchant(desc, credit)
    const base = { bank: 'Bancolombia', role: 'movimiento' as const, amount: value, date, account, merchant }
    const parsed: ParsedAlert = credit
      ? { ...base, kind: 'ingreso', type: 'transferencia-recibida' }
      : {
          ...base, kind: 'gasto',
          type: /^RETIRO/i.test(desc) ? 'retiro' : /^(TRANSF A|TRASLADO|TRANSFERENCIA)/i.test(desc) ? 'transferencia-enviada' : /^PAGO/i.test(desc) ? 'pago' : 'compra',
        }
    const key = `${date}-${value}-${desc.toUpperCase().replace(/[^A-Z0-9]+/g, '-')}`
    const n = (seen.get(key) ?? 0) + 1
    seen.set(key, n)
    items.push({ id: `extracto-bancolombia-${last4}-${key}-${n}`, parsed, own: BANCOLOMBIA_OWN.test(desc) })
  }
  const balance = text.match(/SALDO ACTUAL\s*\$\s?([\d,]*\.\d{2})/i)
  const end = period ? `${period[5]}/${period[4]}/${period[3]}` : ''
  const note = balance ? `Saldo de tu cuenta Bancolombia${end ? ` al ${end}` : ''}: $${parseAmount(balance[1]).toLocaleString('es-CO')}.` : ''
  return { bank: 'Bancolombia', items, note }
}

// ── Tarjeta de crédito Davivienda ─────────────────────────────────────────
// "02Sep2026 INTERES MORA C $1,322 0 de 0 $0 $1,322 $0 1939005 0.00"
// Columnas: fecha, descripción, valor, cuotas, intereses, valor a pagar,
// saldo pendiente, número de transacción y tasa E.A. (coma para miles).
const DAVIVIENDA_CARD_ROW = /^(\d{2})([A-Za-z]{3})(\d{4})\s+(.+?)\s+(-?)\$\s?([\d,]+(?:\.\d{1,2})?)\s+\d+ de \d+\s+-?\$[\d,.]+\s+-?\$[\d,.]+\s+-?\$[\d,.]+\s+\d+\s+([\d.]+)$/

function daviviendaDate(raw: string) {
  const m = raw.match(/(\d{2})\/?([A-Za-z]{3})\/?(\d{4})/)
  return m ? isoFrom(m[1], m[2], m[3]) : ''
}

export function daviviendaCard(lines: string[]): { bank: string; items: StatementItem[]; card: CardSummary | null } {
  const text = lines.join(' ')
  const last4 = text.match(/\d{4} \*{4} \*{4} (\d{4})/)?.[1] ?? ''
  const account = last4 ? `T. Crédito *${last4}` : 'T. Crédito'
  const seen = new Map<string, number>()
  const items: StatementItem[] = []
  let ea = 0
  for (const line of lines) {
    const m = line.match(DAVIVIENDA_CARD_ROW)
    if (!m) continue
    const date = isoFrom(m[1], m[2], m[3])
    const desc = m[4].trim()
    const amount = parseAmount(m[6])
    ea = Math.max(ea, Number(m[7]) / 100)
    if (!date || amount < 1) continue
    const base = { bank: 'Davivienda', role: 'movimiento' as const, amount, date, account }
    const key = `${date}-${amount}-${desc.toUpperCase().replace(/[^A-Z0-9]+/g, '-')}`
    const n = (seen.get(key) ?? 0) + 1
    seen.set(key, n)
    const id = `extracto-davivienda-tc-${last4}-${key}-${n}`
    if (m[5] === '-' || /^(PAGO|ABONO)/i.test(desc)) {
      // Pagar la tarjeta es pasar plata de tu cuenta a la tarjeta: no es gasto.
      items.push({ id, own: true, parsed: { ...base, kind: 'ingreso', type: 'transferencia-recibida', merchant: 'Pago a la tarjeta Davivienda' } })
      continue
    }
    if (/AVANCE/i.test(desc)) {
      // Un avance pasa plata de la tarjeta a tu cuenta: es deuda, no gasto.
      items.push({ id, own: true, parsed: { ...base, kind: 'gasto', type: 'transferencia-enviada', merchant: 'Avance de la tarjeta Davivienda' } })
      continue
    }
    const label = /^INTERES(ES)? (DE )?MORA/i.test(desc) ? 'Intereses de mora tarjeta Davivienda'
      : /^INTERES/i.test(desc) ? 'Intereses tarjeta Davivienda'
      : /CUOTA DE MANEJO/i.test(desc) ? 'Cuota de manejo Davivienda'
      : desc
    items.push({ id, own: false, parsed: { ...base, kind: 'gasto', type: 'compra', merchant: label } })
  }

  const money = (re: RegExp) => {
    const m = text.match(re)
    return m ? parseAmount(m[1]) : 0
  }
  const period = text.match(/Periodo de facturaci[oó]n:?\s*\S+\s*-\s*(\d{2}\/[A-Za-z]{3}\/\d{4})/i)
  const due = text.match(/Fecha l[ií]mite de pago\s*(\d{2}\/[A-Za-z]{3}\/\d{4})/i)
  // "$1,322 $1,322 $8,998,678 $4,500,000": pago mínimo, pago total, cupo disponible, cupo para avances.
  const amounts = text.match(/Pago m[ií]nimo Pago total Cupo disponible.*?\$([\d,]+)\s+\$([\d,]+)\s+\$([\d,]+)/i)
  const cutDate = period ? daviviendaDate(period[1]) : ''
  const card: CardSummary | null = last4 && cutDate
    ? {
        id: `davivienda-${last4}`, bank: 'Davivienda', last4, cutDate,
        totalDebt: amounts ? parseAmount(amounts[2]) : 0,
        minPayment: amounts ? parseAmount(amounts[1]) : 0,
        dueDate: '', available: amounts ? parseAmount(amounts[3]) : 0,
        limit: money(/Cupo total Cupo total para avances\s*\$([\d,]+)/i) || money(/Cupo total\s*\$([\d,]+)/i),
        ea,
      }
    : null
  // Sin nada que pagar no hay fecha límite.
  if (card && card.totalDebt >= 1) card.dueDate = due ? daviviendaDate(due[1]) : ''
  return { bank: 'Davivienda', items, card }
}

// ── Cuenta de ahorros Davivienda ──────────────────────────────────────────
// "02 10 $ 0.01 + 7927 Rendimientos Financieros PROCESOS EMPRESARIAL"
// Columnas: día, mes, valor (punto decimal), + o −, documento (opcional), clase de movimiento y oficina.
const DAVIVIENDA_ROW = /^(\d{2})\s+(\d{2})\s+\$\s?([\d.,]+)\s+([+-])\s+(?:\d+\s+)?(.+)$/

export function daviviendaSavings(lines: string[]): { bank: string; items: StatementItem[]; note: string } {
  const text = lines.join(' ')
  const report = text.match(/INFORME DEL MES:\s*([A-ZÁÉÍÓÚ]+)\s*\/\s*(\d{4})/i)
  const reportMonth = report ? MONTHS.indexOf(report[1].toLowerCase()) + 1 : 0
  const reportYear = report ? Number(report[2]) : new Date().getFullYear()
  const last4 = text.match(/CUENTA DE AHORROS\s+([\d ]{8,})/i)?.[1].replace(/\D/g, '').slice(-4) ?? ''
  const account = last4 ? `*${last4}` : 'Ahorros'
  const seen = new Map<string, number>()
  const items: StatementItem[] = []
  for (const line of lines) {
    const m = line.match(DAVIVIENDA_ROW)
    if (!m) continue
    const amount = parseAmount(m[3])
    if (amount < 1) continue // los rendimientos de centavos no son un movimiento
    // En el extracto de enero pueden venir días de diciembre del año anterior.
    const year = reportMonth && Number(m[2]) > reportMonth ? reportYear - 1 : reportYear
    const date = `${year}-${m[2]}-${m[1]}`
    const desc = m[5].trim()
    const base = { bank: 'Davivienda', role: 'movimiento' as const, amount, date, account }
    const parsed: ParsedAlert = m[4] === '+'
      ? { ...base, kind: 'ingreso', type: 'transferencia-recibida', merchant: desc }
      : { ...base, kind: 'gasto', type: /RETIRO/i.test(desc) ? 'retiro' : /PAGO/i.test(desc) ? 'pago' : /TRANSF/i.test(desc) ? 'transferencia-enviada' : 'compra', merchant: desc }
    const key = `${date}-${amount}-${desc.toUpperCase().replace(/[^A-Z0-9]+/g, '-')}`
    const n = (seen.get(key) ?? 0) + 1
    seen.set(key, n)
    items.push({ id: `extracto-davivienda-${last4}-${key}-${n}`, parsed, own: false })
  }
  const balance = text.match(/Nuevo Saldo\s*\$\s?([\d.,]+)/i)
  const note = balance ? `Saldo de tu cuenta Davivienda al cierre del mes: $${parseAmount(balance[1]).toLocaleString('es-CO')}.` : ''
  return { bank: 'Davivienda', items, note }
}

// Cuenta Nu (de ahorros). Por ahora solo se conocen extractos de meses sin
// movimientos: de esos se toma el saldo final, como dato para ti.
export function nuAccount(lines: string[]): { bank: string; items: StatementItem[]; note: string } {
  const text = lines.join(' ')
  if (!/Cuenta Nu/i.test(text)) throw new Error('De Nu por ahora leo el extracto de la Cuenta Nu, no el de la tarjeta. Mándame uno y lo agrego.')
  if (!/No hiciste movimientos/i.test(text)) {
    throw new Error('Este extracto de la Cuenta Nu tiene movimientos y todavía no sé leerlos. Mándame uno sin clave y lo agrego.')
  }
  const period = text.match(/\d{1,2}\s*-\s*(\d{1,2})\s+([A-Za-z]{3})\w*\s+(\d{4})/)
  const end = period ? isoFrom(period[1], period[2], period[3]) : ''
  const balance = text.match(/Tu dinero a final del mes\s*\$?\s*([\d.,]+)/i)
  const amount = balance ? parseAmount(balance[1]) : 0
  const [y, m, d] = end.split('-').map(Number)
  const when = end ? ` al ${new Date(y, m - 1, d).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })}` : ''
  return { bank: 'Nu', items: [], note: `Cuenta Nu sin movimientos ese mes; saldo${when}: $${amount.toLocaleString('es-CO')}.` }
}

export function statementFromPdfLines(lines: string[]): { bank: string; items: StatementItem[]; card?: CardSummary | null; note?: string } {
  const text = lines.join(' ')
  if (/901\.658\.107|Nu Colombia Compa/i.test(text)) return nuAccount(lines)
  // Antes que Nequi: el extracto de la cuenta Bancolombia menciona "TRANSFERENCIAS A NEQUI".
  if (/bancolombia/i.test(text) && /CUENTA DE AHORROS/i.test(text) && /ESTADO DE CUENTA/i.test(text)) return bancolombiaSavings(lines)
  if (/TUYA S\.?A|tuya\.com\.co|Mastercard Carulla/i.test(text)) return { bank: 'Tuya', items: tuyaItems(lines), card: tuyaSummary(lines) }
  if (/dep[oó]sito de bajo monto|NEQUI/i.test(text)) return { bank: 'Nequi', items: statementItems(rowsFromStatementLines(lines)) }
  // Nequi va antes: sus extractos mencionan a Bancolombia y Davivienda en los pagos.
  if (/860\.034\.313|Banco Davivienda S\.?A/i.test(text)) {
    if (/Extracto Cr[eé]dito/i.test(text)) return { bank: 'Davivienda', items: [], card: daviviendaLoanSummary(lines) }
    if (/CUENTA DE AHORROS/i.test(text)) return daviviendaSavings(lines)
    if (/Periodo de facturaci[oó]n/i.test(text) && /\*{4} \*{4} \d{4}/.test(text)) return daviviendaCard(lines)
    throw new Error('No reconocí este extracto de Davivienda. Leo el del crédito, la cuenta de ahorros y la tarjeta de crédito; mándame este sin clave y lo reviso.')
  }
  if (/890\.903\.938|bancolombia\.com/i.test(text)) return { bank: 'Bancolombia', items: bancolombiaCardItems(lines), card: bancolombiaSummary(lines) }
  throw new Error('Por ahora leo extractos de Nequi, Tuya, las tarjetas Bancolombia y el crédito Davivienda. Mándame un ejemplo de este banco y lo agrego.')
}
