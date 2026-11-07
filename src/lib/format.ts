const cop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })

// Modo privado: oculta los montos en pantalla, como el ojo de la app del banco.
// Se recuerda en cada dispositivo, no se sincroniza.
function readHidden() {
  try {
    return localStorage.getItem('hideAmounts') === '1'
  } catch {
    return false
  }
}

let hidden = readHidden()

export function amountsHidden() {
  return hidden
}

export function setAmountsHidden(value: boolean) {
  hidden = value
  try {
    localStorage.setItem('hideAmounts', value ? '1' : '0')
  } catch {
    /* sin almacenamiento: dura hasta cerrar la app */
  }
}

export function money(n: number) {
  if (hidden) return '$ ••••'
  return cop.format(Math.round(n)).replace(/\s/g, ' ')
}

export function moneyInput(n: number) {
  return n ? new Intl.NumberFormat('es-CO').format(n) : ''
}

export function parseMoney(s: string) {
  const n = Number(s.replace(/[^\d]/g, ''))
  return Number.isFinite(n) ? n : 0
}

export function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function currentMonth() {
  return todayISO().slice(0, 7)
}

export function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function monthLabel(month: string) {
  const [y, m] = month.split('-').map(Number)
  const s = new Date(y, m - 1, 1).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function dayLabel(date: string) {
  const [y, m, d] = date.split('-').map(Number)
  const s = new Date(y, m - 1, d).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'short' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function daysInMonth(month: string) {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}
