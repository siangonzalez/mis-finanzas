import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { bitsToLines } from './pdf'
import { readNequiDocx, rowsFromStatementLines, statementFromPdfLines, statementItems } from './statements'

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
    expect(() => rowsFromStatementLines(['Banco Ejemplo', '01/01/2026 Algo $1.00 $2.00'])).toThrow(/leo extractos de Nequi, Tuya y las tarjetas Bancolombia/)
  })
})

describe('extracto de Tuya (tarjeta de crédito)', () => {
  // Líneas inventadas con el formato real del PDF de Tuya.
  const lines = [
    'Extracto Tarjeta de Crédito',
    'Fecha Descripción',
    '2026/08/06 -PAGO PSE 672.755,00 0,00 0,00 0,00% 0,00% 0/0',
    '2026/08/07 +COMPRA INTERNACIONA | CAPCUT 59.900,00 0,00 0,00 2,18% 29,62% 36/36',
    '2026/08/10 -AJUSTE AUTOMATICO I 1.258,53 0,00 0,00 0,00% 0,00% 0/0',
    '2026/08/11 +COMPRA INTERNACIONA | GOOGLE *Google One 19.900,00 0,00 0,00 2,18% 29,62% 36/36',
    '2026/08/26 +COMPRAS RECURR | ADOBE 93.058,00 0,00 0,00 2,18% 29,62% 1/1',
    '2026/09/06 +COMPRA INTERNACIONA | CapCut 59.900,00 58.236,11 1.663,89 2,15% 29,20% 1/36',
    '2026/09/09 +CUOTA DE MANEJO 41.900,00 0,00 0,00 0,00% 0,00% 0/0',
    '2026/09/09 +SEG DEUD IVA INCL 3.250,00 0,00 0,00 0,00% 0,00% 0/0',
    'Número de tarjeta: ************9999',
    'En caso de pago con cheque girar a nombre de TUYA S.A NIT 000000000-0',
  ]
  const { bank, items } = statementFromPdfLines(lines)
  const by = (m: string) => items.find((i) => i.parsed.merchant === m)

  it('reconoce que es de Tuya y lee todas las filas', () => {
    expect(bank).toBe('Tuya')
    expect(items).toHaveLength(8)
  })

  it('las compras son gastos por el valor total de la compra', () => {
    expect(by('CAPCUT')?.parsed).toMatchObject({ kind: 'gasto', amount: 59900, date: '2026-08-07', account: 'T. Crédito *9999' })
    expect(by('GOOGLE *Google One')?.parsed.amount).toBe(19900)
    expect(by('ADOBE')?.parsed.amount).toBe(93058)
    expect(by('Cuota de manejo Tuya')?.parsed.amount).toBe(41900)
    expect(by('Seguro deudores Tuya')?.parsed.amount).toBe(3250)
  })

  it('el pago a la tarjeta es entre tus cuentas, no un ingreso', () => {
    expect(by('Pago a la tarjeta Tuya')).toMatchObject({ own: true, parsed: { amount: 672755 } })
    expect(by('Ajuste o devolución Tuya')).toMatchObject({ own: false, parsed: { kind: 'ingreso', amount: 1259 } })
  })

  it('una compra a cuotas tiene el mismo id en el extracto siguiente', () => {
    const next = statementFromPdfLines([...lines.slice(0, 2), '2026/09/06 +COMPRA INTERNACIONA | CapCut 59.900,00 56.000,00 2.236,11 2,15% 29,20% 2/36', ...lines.slice(-2)])
    expect(next.items[0].id).toBe(by('CapCut')!.id)
  })
})

describe('extracto de tarjeta Bancolombia', () => {
  // Líneas inventadas con el formato real del PDF (texto repetido incluido).
  const lines = [
    'Tarjeta: ************1234 Tarjeta: ************1234 Tarjeta: ************1234',
    'NIT: 890.903.938-8 ESTADO DE CUENTA EN: DOLARES',
    'Nuevos movimientos entre 15 sep hasta 15 oct. 2026',
    '000000 20/09/2026 AMAZON PRIME $ 14.990,00 $ 14.990,00 $ 0,00',
    'NIT: 890.903.938-8 ESTADO DE CUENTA EN: PESOS',
    'Nuevos movimientos entre 15 sep hasta 15 oct. 2026 Nuevos movimientos entre 15 sep hasta 15 oct. 2026',
    '15/10/2026 INTERESES CORRIENTES $ 123.067,71 $ 123.067,71 $ 0,00',
    '000000 15/10/2026 CUOTA DE MANEJO $ 36.990,00 $ 36.990,00 $ 0,00',
    '000000 14/10/2026 COMISION AVANCE SUCURSA $ 6.840,00 $ 6.840,00 $ 0,00',
    'C00001 14/10/2026 AVANCE SUCURSAL VIRTUAL $ 2.000.000,00 1/24 $ 83.333,33 2,1155 % 28,5582 % $ 1.916.666,67',
    'R00002 05/10/2026 TIENDA DE BICICLETAS $ 178.500,00 1/3 $ 59.500,00 2,1155 % 28,5582 % $ 119.000,00',
    'C00003 01/10/2026 ABONO SUCURSAL VIRTUAL $ -436.595,00 $ -436.595,00 $ 0,00',
    'Movimientos antes de 15 sep Movimientos antes de 15 sep',
    'C00004 22/08/2026 AVANCE SUCURSAL VIRTUAL $ 5.000.000,00 2/24 $ 208.333,33 2,1155 % 28,5582 % $ 4.583.333,34',
  ]
  const { bank, items } = statementFromPdfLines(lines)
  const by = (m: string) => items.find((i) => i.parsed.merchant === m)

  it('lee solo los movimientos nuevos en pesos', () => {
    expect(bank).toBe('Bancolombia')
    expect(items).toHaveLength(6)
    expect(by('AMAZON PRIME')).toBeUndefined()
    expect(items.some((i) => i.parsed.amount === 5_000_000)).toBe(false)
  })

  it('compras y costos de la tarjeta son gastos', () => {
    expect(by('TIENDA DE BICICLETAS')?.parsed).toMatchObject({ kind: 'gasto', amount: 178500, date: '2026-10-05', account: 'T. Crédito *1234' })
    expect(by('Intereses tarjeta Bancolombia')?.parsed.amount).toBe(123068)
    expect(by('Cuota de manejo Bancolombia')?.parsed.amount).toBe(36990)
    expect(by('Comisión tarjeta Bancolombia')?.parsed.amount).toBe(6840)
  })

  it('abonos y avances son entre tus cuentas', () => {
    expect(by('Pago a la tarjeta Bancolombia')).toMatchObject({ own: true, parsed: { kind: 'ingreso', amount: 436595 } })
    expect(by('Avance de la tarjeta Bancolombia')).toMatchObject({ own: true, parsed: { kind: 'gasto', amount: 2000000 } })
  })
})

describe('resumen de la tarjeta (cuánto debes y cuándo pagar)', () => {
  it('Tuya', () => {
    const c = statementFromPdfLines([
      '05-oct-2026 $48.566,94 $168.159,03',
      'Fecha de Corte: 09-sep-2026 (+) Abono a capital 3.416,94',
      '*Cupo Total: $8.600.000 (+) Cobro por avances 0,00',
      '*Cupo Disponible: $8.431.840',
      'Compras 2,15800% 29,20180%',
      'Mora 2,16018% 29,23490%',
      'Número de tarjeta: ************9999',
      'girar a nombre de TUYA S.A NIT 000000000-0',
    ]).card
    expect(c).toEqual({
      id: 'tuya-9999', bank: 'Tuya', last4: '9999', dueDate: '2026-10-05', cutDate: '2026-09-09',
      minPayment: 48567, totalDebt: 168159, limit: 8600000, available: 8431840, ea: 0.292018,
    })
  })

  it('Bancolombia (solo la parte en pesos)', () => {
    const c = statementFromPdfLines([
      'Tarjeta: ************1234 Tarjeta: ************1234',
      'Moneda: DOLARES Moneda: DOLARES',
      '15 sep - 15 oct. 2026 $ 0,00 $ 0,00 $ 0,00',
      'NIT: 890.903.938-8 ESTADO DE CUENTA EN: DOLARES',
      'Detalles del movimiento',
      'Moneda: PESOS Moneda: PESOS',
      'Deuda a la fecha de corte: Periodo facturado Pago Total:',
      '15 sep - 15 oct. 2026 $ 7.556.731,00 $ 7.556.731,00 $ 7.556.731,00',
      'Cupo total: $ 7.800.000,00',
      'nov. 03, 2026 nov. 03, 2026 nov. 03, 2026 $ 538.898,00 $ 538.898,00 $ 538.898,00',
      'Disponible: $ 243.269,46',
      'Avances 2.1155% 28.5582%',
      'Detalles del movimiento',
    ]).card
    expect(c).toMatchObject({
      id: 'bancolombia-1234', cutDate: '2026-10-15', dueDate: '2026-11-03', totalDebt: 7556731,
      minPayment: 538898, limit: 7800000, available: 243269, ea: 0.285582,
    })
  })
})
