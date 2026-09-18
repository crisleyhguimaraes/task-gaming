import { expect, it } from 'vitest'
import { levelFor } from './levels'

it('levelFor', () => {
  expect(levelFor(0)).toMatchObject({ level: 1, name: 'Iniciante', pct: 0, toNext: 100 })
  expect(levelFor(99)).toMatchObject({ level: 1, pct: 99 })
  expect(levelFor(100)).toMatchObject({ level: 2, name: 'Aprendiz', pct: 0 })
  expect(levelFor(450)).toMatchObject({ level: 3, name: 'Executor', pct: 50, toNext: 150 })
  expect(levelFor(9999)).toMatchObject({ level: 7, name: 'Lenda', next: null, pct: 100, toNext: 0 })
})
