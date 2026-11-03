// Categorías tomadas de la hoja "Drop Down" del Excel de finanzas personales.

export type Kind = 'ingreso' | 'gasto'

export interface Category {
  name: string
  emoji: string
  color: string
  subcategories: string[]
}

export const EXPENSE_CATEGORIES: Category[] = [
  { name: 'Hogar', emoji: '🏠', color: '#7c9cff', subcategories: ['Arriendo', 'Administración', 'Luz', 'Agua', 'Internet', 'Gas', 'TV', 'Otros'] },
  { name: 'Comida', emoji: '🍽️', color: '#ffb35c', subcategories: ['Mercado', 'Domicilios', 'Salidas a comer', 'Otros'] },
  { name: 'Transporte', emoji: '🚌', color: '#4fd1c5', subcategories: ['Transporte público', 'Gasolina', 'Impuesto vehículo', 'Seguro vehículo', 'Parqueaderos', 'Peajes', 'App de movilidad', 'Otros'] },
  { name: 'Suscripciones', emoji: '📺', color: '#b18cff', subcategories: ['Gimnasio', 'Rappi', 'Netflix', 'HBO', 'Disney Plus', 'YouTube', 'Spotify', 'Apple Music', 'Plan de datos', 'Otras'] },
  { name: 'Salud', emoji: '🩺', color: '#5ad18a', subcategories: ['EPS', 'Medicamentos', 'Exámenes', 'Gym', 'Otros'] },
  { name: 'Educación', emoji: '🎓', color: '#5cc8ff', subcategories: ['Matrícula', 'Pensión', 'Semestre', 'Materiales', 'Otros'] },
  { name: 'Deudas', emoji: '💳', color: '#ff6b81', subcategories: ['Tarjeta de crédito', 'Crédito casa', 'Crédito carro', 'Crédito celular', 'Gota a gota', 'Otros'] },
  { name: 'Entretenimiento', emoji: '🎉', color: '#ff8fd1', subcategories: ['Diversión', 'Viajes', 'Fiestas', 'Conciertos', 'Motel', 'Condones', 'Otros'] },
  { name: 'Regalos', emoji: '🎁', color: '#f6d365', subcategories: ['Mamá', 'Papá', 'Hermano/a', 'Pareja', 'Hijos', 'Amigos', 'Ex', 'Otros'] },
  { name: 'Donación', emoji: '🤲', color: '#9be15d', subcategories: ['Iglesia', 'Fundación', 'Familia', 'Persona necesitada', 'Otro'] },
  { name: 'Otros', emoji: '📦', color: '#a0a6b8', subcategories: ['Otros'] },
]

export const INCOME_CATEGORIES: Category[] = [
  { name: 'Salario', emoji: '💼', color: '#5ad18a', subcategories: ['Salario'] },
  { name: 'Honorarios', emoji: '🧾', color: '#4fd1c5', subcategories: ['Honorarios'] },
  { name: 'Bonos', emoji: '🎯', color: '#7c9cff', subcategories: ['Bonos'] },
  { name: 'Dividendos', emoji: '📈', color: '#b18cff', subcategories: ['Dividendos', 'Intereses'] },
  { name: 'Comisiones', emoji: '🤝', color: '#ffb35c', subcategories: ['Comisiones'] },
  { name: 'Préstamos', emoji: '🏦', color: '#ff6b81', subcategories: ['Préstamos'] },
  { name: 'Herencia', emoji: '🕊️', color: '#f6d365', subcategories: ['Herencia'] },
  { name: 'Otros', emoji: '📦', color: '#a0a6b8', subcategories: ['Otros'] },
]

export function categoriesFor(kind: Kind): Category[] {
  return kind === 'ingreso' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES
}

export function findCategory(kind: Kind, name: string): Category {
  const list = categoriesFor(kind)
  return list.find((c) => c.name === name) ?? list[list.length - 1]
}
