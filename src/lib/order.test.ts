import { expect, it } from 'vitest'
import { calculateNewOrder } from './order'

it('calculateNewOrder', () => {
  expect(calculateNewOrder(null, null)).toBe(1000)
  expect(calculateNewOrder(null, 500)).toBe(-500)
  expect(calculateNewOrder(500, null)).toBe(1500)
  expect(calculateNewOrder(10, 20)).toBe(15)
})
