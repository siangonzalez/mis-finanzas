import { expect, it } from 'vitest'
import { passwordVariants } from './pdf'

it('prueba la clave sin espacios y, si es un número, sin puntos ni guiones', () => {
  expect(passwordVariants([' 1.234.567 '])).toEqual([' 1.234.567 ', '1.234.567', '1234567'])
  expect(passwordVariants(['Clave Nu'])).toEqual(['Clave Nu'])
  expect(passwordVariants(['123-45', '123-45'])).toEqual(['123-45', '12345'])
})
