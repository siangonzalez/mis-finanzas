import type { Kind } from '../data/categories'

export interface Suggestion {
  category: string
  subcategory: string
}

export interface UserRule extends Suggestion {
  key: string // comercio normalizado
  kind: Kind
}

// "UBER*RIDES" → "UBER RIDES", "BOLD SA*ANA MARI" → "BOLD ANA MARI": clave estable para reglas.
export function merchantKey(merchant: string) {
  return merchant
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\b(SAS|SA|S A|LTDA|COLOMBIA|EXPRESS)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 3)
    .join(' ')
}

const DEFAULTS: [RegExp, Kind, Suggestion][] = [
  [/UBER|DIDI|CABIFY|INDRIVE|BEAT/, 'gasto', { category: 'Transporte', subcategory: 'App de movilidad' }],
  [/TERPEL|PRIMAX|TEXACO|BIOMAX|ESSO|GASOLINA|AUTOCENTRO/, 'gasto', { category: 'Transporte', subcategory: 'Gasolina' }],
  [/PARQUEADERO|PARKING|CITY ?PARKING/, 'gasto', { category: 'Transporte', subcategory: 'Parqueaderos' }],
  [/PEAJE/, 'gasto', { category: 'Transporte', subcategory: 'Peajes' }],
  [/TRANSMILENIO|TULLAVE|RECARGA TM/, 'gasto', { category: 'Transporte', subcategory: 'Transporte público' }],
  [/NETFLIX/, 'gasto', { category: 'Suscripciones', subcategory: 'Netflix' }],
  [/SPOTIFY/, 'gasto', { category: 'Suscripciones', subcategory: 'Spotify' }],
  [/DISNEY/, 'gasto', { category: 'Suscripciones', subcategory: 'Disney Plus' }],
  [/HBO|\bMAX\b/, 'gasto', { category: 'Suscripciones', subcategory: 'HBO' }],
  [/YOUTUBE|GOOGLE \*YOUTUBE/, 'gasto', { category: 'Suscripciones', subcategory: 'YouTube' }],
  [/APPLE\.COM|APPLE COM|ITUNES/, 'gasto', { category: 'Suscripciones', subcategory: 'Otras' }],
  [/SMART ?FIT|BODYTECH|GYM/, 'gasto', { category: 'Suscripciones', subcategory: 'Gimnasio' }],
  [/RAPPI|DOMICILIOS|IFOOD/, 'gasto', { category: 'Comida', subcategory: 'Domicilios' }],
  [/CARULLA|EXITO|\bD1\b|\bARA\b|OLIMPICA|JUMBO|MERQUE|ALKOSTO|MAKRO|SURTIMAX|ISIMO|OXXO|FRUVER/, 'gasto', { category: 'Comida', subcategory: 'Mercado' }],
  [/RESTAURANTE|CREPES|FRISBY|MCDONALD|BURGER|EL CORRAL|JUAN VALDEZ|TOSTAO|STARBUCKS|PANADERIA|COFFEE|CAFE/, 'gasto', { category: 'Comida', subcategory: 'Salidas a comer' }],
  [/CINE|CINEMARK|PROCINAL|TUBOLETA|TICKETMASTER|ETICKET/, 'gasto', { category: 'Entretenimiento', subcategory: 'Diversión' }],
  [/DROGUERIA|FARMATODO|CRUZ VERDE|COLSUBSIDIO|LOCATEL/, 'gasto', { category: 'Salud', subcategory: 'Medicamentos' }],
  [/CODENSA|ENEL/, 'gasto', { category: 'Hogar', subcategory: 'Luz' }],
  [/ACUEDUCTO/, 'gasto', { category: 'Hogar', subcategory: 'Agua' }],
  [/VANTI|GAS NATURAL/, 'gasto', { category: 'Hogar', subcategory: 'Gas' }],
  [/CLARO|MOVISTAR|TIGO|\bETB\b|WOM/, 'gasto', { category: 'Hogar', subcategory: 'Internet' }],
  [/CONJ|CONJUNTO|ADMINISTRACION|PROPIEDAD HORIZONTAL/, 'gasto', { category: 'Hogar', subcategory: 'Administración' }],
  [/DAVIVIENDA|CARTERA|TARJETA|BANCO|TUYA|NU COLOMBIA|CREDITO/, 'gasto', { category: 'Deudas', subcategory: 'Tarjeta de crédito' }],
  [/ADOBE|CAPCUT|GOOGLE ?\*|NETLIFY|HIGGSFIELD|CANVA|OPENAI|CHATGPT|ANTHROPIC|CLAUDE|EPIDEMIC|FIGMA|NOTION|DROPBOX|ICLOUD/, 'gasto', { category: 'Suscripciones', subcategory: 'Otras' }],
  [/CUOTA DE MANEJO|SEGURO DEUDORES|SEG DEUD|INTERESES TARJETA/, 'gasto', { category: 'Deudas', subcategory: 'Tarjeta de crédito' }],
  [/PAPELERIA|LIBRERIA|PANAMERICANA/, 'gasto', { category: 'Educación', subcategory: 'Materiales' }],
  [/FERRETERIA|HOMECENTER|CONSTRUCTOR/, 'gasto', { category: 'Hogar', subcategory: 'Otros' }],
  [/4X1000|GRAVAMEN/, 'gasto', { category: 'Otros', subcategory: 'Otros' }],
  [/^RETIRO/, 'gasto', { category: 'Otros', subcategory: 'Otros' }],
]

export function suggestCategory(merchant: string, kind: Kind, userRules: UserRule[]): Suggestion {
  const key = merchantKey(merchant)
  const own = userRules.find((r) => r.kind === kind && r.key === key)
  if (own) return { category: own.category, subcategory: own.subcategory }

  if (kind === 'ingreso') {
    return /INTERES|RENDIMIENTO/i.test(merchant) ? { category: 'Dividendos', subcategory: 'Intereses' } : { category: 'Otros', subcategory: 'Otros' }
  }

  const upper = merchant.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  for (const [re, k, s] of DEFAULTS) if (k === kind && re.test(upper)) return s
  return { category: 'Otros', subcategory: 'Otros' }
}
