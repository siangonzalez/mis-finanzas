import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { bitsToLines } from './pdf'
import { readNequiDocx, rowsFromStatementLines, statementItems } from './statements'

// Extracto inventado con el formato real de Nequi (tabla de 4 columnas).
function docx(rows: string[][]) {
  const cell = (t: string) => `<w:tc><w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p></w:tc>`
  const tr = (r: string[]) => `<w:tr>${r.map(cell).join('')}</w:tr>`
  const xml = `<w:document><w:body><w:p><w:r><w:t>Extracto de depósito de bajo monto de:</w:t></w:r></w:p>
    <w:tbl>${tr(['Fecha del movimiento', 'Descripción', 'Valor', 'Saldo'])}${rows.map(tr).join('')}</w:tbl></w:body></w:document>`
  const z = zipSync({ 'word/document.xml': strToU8(xml) })
  return z.buffer.slice(z.byteOffset, z.byteOffset + z.byteLength) as ArrayBuffer
}

const file = docx([
  ['29/10/2026', 'ANA*** RUI*** GOM***', '$-440,000.00', '$8,049.42'],
  ['28/10/2026', 'PAGO EN QR BRE-B: Ferreteria', '$-31,000.00', '$559,359.42'],
  ['28/10/2026', 'GRAVAMEN AL MOVIMIENTO', '$-124.00', '$590,359.42'],
  ['24/10/2026', 'GRAVAMEN AL MOVIMIENTO', '$-16.38', '$590,483.42'],
  ['23/10/2026', 'De PEDRO RUIZ', '$600,000.00', '$609,359.42'],
  ['20/10/2026', 'Para LUIS PEREZ', '$-9,300.00', '$9,359.42'],
  ['19/10/2026', 'ENVIO CON BRE-B A: Nicolás', '$-30,000.00', '$18,659.42'],
  ['18/10/2026', 'COMPRA PSE EN Davivienda', '$-1,322.00', '$48,659.42'],
  ['17/10/2026', 'Recarga desde Bancolombia', '$50,000.00', '$49,981.42'],
  ['03/10/2026', 'Pago de Intereses', '$44.01', '$8,154.33'],
  ['03/10/2026', 'PAGO EN QR BRE-B:', '$-25,000.00', '$8,110.32'],
])

describe('extracto de Nequi', () => {
  const rows = readNequiDocx(file)
  const items = statementItems(rows)
  const by = (merchant: string) => items.find((i) => i.parsed.merchant === merchant)

  it('lee todas las filas de movimientos', () => {
    expect(rows).toHaveLength(11)
    expect(rows[0]).toEqual({ date: '2026-10-29', description: 'ANA*** RUI*** GOM***', amount: -440000, balance: 8049 })
  })

  it('clasifica cada tipo de movimiento', () => {
    expect(by('Ferreteria')?.parsed).toMatchObject({ kind: 'gasto', type: 'compra', amount: 31000 })
    expect(by('PEDRO RUIZ')?.parsed).toMatchObject({ kind: 'ingreso', amount: 600000 })
    expect(by('Transferencia a LUIS PEREZ')?.parsed.kind).toBe('gasto')
    expect(by('Transferencia a Nicolás')?.parsed.amount).toBe(30000)
    expect(by('Davivienda')?.parsed.type).toBe('pago')
    expect(by('Intereses Nequi')?.parsed.kind).toBe('ingreso')
    expect(by('Pago con QR')?.parsed.amount).toBe(25000)
  })

  it('marca lo que es entre tus propias cuentas', () => {
    expect(by('Envío a otra cuenta tuya')?.own).toBe(true)
    expect(by('Recarga desde Bancolombia')?.own).toBe(true)
    expect(items.filter((i) => i.own)).toHaveLength(2)
  })

  it('junta el 4x1000 del mes en un solo gasto', () => {
    expect(by('4x1000 de octubre')?.parsed).toMatchObject({ amount: 140, date: '2026-10-28' })
    expect(items.filter((i) => /GRAVAMEN/i.test(i.parsed.merchant))).toHaveLength(0)
  })

  it('los ids son estables para no repetir al cargar dos veces', () => {
    expect(statementItems(readNequiDocx(file)).map((i) => i.id)).toEqual(items.map((i) => i.id))
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length)
  })

  it('rechaza un documento que no es de Nequi', () => {
    const z = zipSync({ 'word/document.xml': strToU8('<w:document>Contrato</w:document>') })
    expect(() => readNequiDocx(z.buffer as ArrayBuffer)).toThrow(/Nequi/)
  })
})

describe('extracto de Nequi en PDF', () => {
  it('arma líneas con el texto que está a la misma altura', () => {
    const lines = bitsToLines([
      { str: '$-30,000.00', x: 400, y: 500 },
      { str: '24/08/2026', x: 40, y: 500.6 },
      { str: 'ENVIO CON BRE-B A: Nicolás', x: 120, y: 499.5 },
      { str: '$380.91', x: 500, y: 500 },
      { str: 'Fecha del movimiento', x: 40, y: 520 },
    ])
    expect(lines).toEqual(['Fecha del movimiento', '24/08/2026 ENVIO CON BRE-B A: Nicolás $-30,000.00 $380.91'])
  })

  it('lee los movimientos y une descripciones de dos líneas', () => {
    const rows = rowsFromStatementLines([
      'Extracto de depósito de bajo monto de: NEQUI S.A.',
      'Fecha del movimiento Descripción Valor Saldo',
      '24/08/2026 ENVIO CON BRE-B A: Nicolás $-30,000.00 $380.91',
      '24/08/2026 GRAVAMEN AL MOVIMIENTO $-120.00 $30,380.91',
      '21/08/2026 De ANA MARIA $23,000.00 $244,939.33',
      '20/08/2026 Para LUIS EDUARDO $-9,800.00 $221,939.33',
      'PEREZ GOMEZ',
      'Página 1 de 2',
    ])
    expect(rows).toHaveLength(4)
    expect(rows[0]).toEqual({ date: '2026-08-24', description: 'ENVIO CON BRE-B A: Nicolás', amount: -30000, balance: 381 })
    expect(rows[2].amount).toBe(23000)
    expect(rows[3].description).toBe('Para LUIS EDUARDO PEREZ GOMEZ')
  })

  it('avisa si el PDF no es de Nequi', () => {
    expect(() => rowsFromStatementLines(['Banco Ejemplo', '01/01/2026 Algo $1.00 $2.00'])).toThrow(/solo leo extractos de Nequi/)
  })
})
