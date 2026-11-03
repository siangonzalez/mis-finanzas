import { describe, expect, it } from 'vitest'
import { parseAlert, parseAmount } from './parsers'
import { merchantKey, suggestCategory } from './rules'

// Textos con el formato real de cada alerta (nombres de personas cambiados).

describe('parseAmount', () => {
  it.each([
    ['$527000.00', 527000],
    ['$100,000.00', 100000],
    ['$6.057,00', 6057],
    ['$ 28.540,28', 28540],
    ['$28.900', 28900],
    ['$ 527,000.00 COP', 527000],
    ['$1.200.000', 1200000],
  ])('%s → %d', (raw, n) => expect(parseAmount(raw)).toBe(n))
})

describe('Bancolombia', () => {
  it('compra con débito', () => {
    expect(parseAlert('¡Listo! Todo salió bien con tus movimientos Bancolombia: Compraste $28.540,28 en Epidemic Sound AB con tu T.Deb *1111, el 19/10/2026 a las 17:19. Si tienes dudas, encuentranos aqui: 6045109095')).toMatchObject({
      bank: 'Bancolombia', role: 'movimiento', kind: 'gasto', type: 'compra',
      amount: 28540, merchant: 'Epidemic Sound AB', account: 'T. Débito *1111', date: '2026-10-19', time: '17:19',
    })
  })

  it('compra con crédito', () => {
    expect(parseAlert('Bancolombia: Compraste $45.000,00 en RAPPI con tu T.Cred *1234, el 02/11/2026 a las 20:10.')).toMatchObject({
      amount: 45000, merchant: 'RAPPI', account: 'T. Crédito *1234',
    })
  })

  it('retiro en cajero', () => {
    expect(parseAlert('Bancolombia: Retiraste $100.000,00 en SVB 3848_Calle 170 de tu T.Deb **1111 el 26/09/2026 a las 12:23. Si tienes dudas')).toMatchObject({
      type: 'retiro', amount: 100000, merchant: 'Retiro SVB 3848_Calle 170', date: '2026-09-26',
    })
  })

  it('pago desde la cuenta', () => {
    expect(parseAlert('Bancolombia: Pagaste $527000.00 a Banco Davivienda SA Zona Pa desde tu producto 2222 el 29/10/2026 12:48:17. ¿Dudas?')).toMatchObject({
      type: 'pago', amount: 527000, merchant: 'Banco Davivienda SA Zona Pa', account: '*2222', date: '2026-10-29', time: '12:48',
    })
  })

  it('transferencia recibida', () => {
    expect(parseAlert('Bancolombia: recibiste una transferencia de MARIA PEREZ por $100,000.00 en tu cuenta *2222 conectada a la llave @MILLAVE el 22/10/26 a las 18:54. Con llaves es de una')).toMatchObject({
      kind: 'ingreso', type: 'transferencia-recibida', amount: 100000, merchant: 'MARIA PEREZ', date: '2026-10-22',
    })
  })
})

describe('otros bancos', () => {
  it('Nequi', () => {
    expect(parseAlert('¡Pago exitoso! Hiciste un pago en TECNIPAGOS S A por $28.900 Fecha: El 27 de septiembre de 2026 Hora: 2:03 p. m. CUS: 987654321')).toMatchObject({
      bank: 'Nequi', role: 'movimiento', amount: 28900, merchant: 'TECNIPAGOS S A', date: '2026-09-27', time: '14:03',
    })
  })

  it('Nequi: envío por Bre-B', () => {
    expect(parseAlert('¡Realizaste un envío por Bre-B y todo salió bien! ¡Hola, ANA! Enviaste de manera exitosa 22.000 a la llave 0090000000 de PEDRO RUIZ el 27 de septiembre de 2026 a la 1:02 p.m. Revisa el detalle')).toMatchObject({
      bank: 'Nequi', kind: 'gasto', type: 'transferencia-enviada', amount: 22000, merchant: 'Transferencia a PEDRO RUIZ', date: '2026-09-27', time: '13:02',
    })
    expect(parseAlert('Enviaste de manera exitosa 16.000 a la llave 0090000001 de LUIS PEREZ el 9 de septiembre de 2026 a las 12:36 pm Revisa')).toMatchObject({
      amount: 16000, merchant: 'Transferencia a LUIS PEREZ', time: '12:36',
    })
  })

  it('Nequi: plata recibida por Bre-B', () => {
    expect(parseAlert('¡Recibiste plata por Bre-B! ¡Hola, ANA ! Recibiste 60.000 de MARIA LOPEZ el 9 de julio de 2026 a las 12:32 p.m, desde el banco Davivienda.')).toMatchObject({
      bank: 'Nequi', kind: 'ingreso', type: 'transferencia-recibida', amount: 60000, merchant: 'MARIA LOPEZ', date: '2026-07-09', time: '12:32',
    })
  })

  it('PSE es un comprobante', () => {
    expect(parseAlert('Bienvenido al sistema Protegido ACH. | Valor: $ 527.000,00 | | Empresa: Banco Davivienda S.A. (Zona Pagos) | | Descripción: Pagos | | Fecha de la transacción: 29/10/2026 | | CUS: 123456789')).toMatchObject({
      bank: 'PSE', role: 'comprobante', amount: 527000, merchant: 'Banco Davivienda S.A. (Zona Pagos)', date: '2026-10-29',
    })
  })

  it('recibo de pago Davivienda es un comprobante', () => {
    expect(parseAlert('Estimado(a) cliente su pago ha sido exitoso. #### Resumen de pago PSE-100000001 Concepto: Pagos Valor total: $ 527,000.00 COP Fecha y hora transacción: 29/10/2026 12:48 #### Davivienda Cartera Creditos Dirección: Avenida El Dorado')).toMatchObject({
      bank: 'Davivienda', role: 'comprobante', amount: 527000, merchant: 'Davivienda Cartera Creditos', date: '2026-10-29',
    })
  })

  it('texto que no es alerta', () => {
    expect(parseAlert('0% de interés en iShop. Compra tu iPhone')).toBeNull()
  })
})

describe('categorías sugeridas', () => {
  it('reconoce comercios comunes', () => {
    expect(suggestCategory('UBER*RIDES', 'gasto', [])).toEqual({ category: 'Transporte', subcategory: 'App de movilidad' })
    expect(suggestCategory('MERQUEFAM EXPRESS AR', 'gasto', []).category).toBe('Comida')
    expect(suggestCategory('NETFLIX', 'gasto', []).subcategory).toBe('Netflix')
    expect(suggestCategory('CINES PREMIER', 'gasto', []).category).toBe('Entretenimiento')
    expect(suggestCategory('GOOGLE *Google One', 'gasto', []).category).toBe('Suscripciones')
    expect(suggestCategory('ADOBE', 'gasto', []).category).toBe('Suscripciones')
    expect(suggestCategory('Cuota de manejo Tuya', 'gasto', []).subcategory).toBe('Tarjeta de crédito')
  })

  it('a cada persona le corresponde su propia regla', () => {
    expect(merchantKey('Transferencia a JUAN CAMILO OSMA')).toBe('TRANSFERENCIA A JUAN CAMILO OSMA')
    expect(merchantKey('Transferencia a JUAN SEBASTIAN HOYOS')).not.toBe(merchantKey('Transferencia a JUAN CAMILO OSMA'))
    expect(merchantKey('UBER*RIDES')).toBe('UBER RIDES')
    expect(merchantKey('***')).toBe('')
  })

  it('las reglas propias ganan', () => {
    const rules = [{ key: merchantKey('FACEBK *ABC123'), kind: 'gasto' as const, category: 'Educación', subcategory: 'Otros' }]
    expect(suggestCategory('FACEBK *ZZ99', 'gasto', rules).category).toBe('Otros')
    expect(suggestCategory('FACEBK *ABC123', 'gasto', rules).category).toBe('Educación')
  })
})
