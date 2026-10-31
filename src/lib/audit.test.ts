import { describe, expect, it } from 'vitest'
import { diffFields } from './audit'

describe('diffFields', () => {
  const before = { title: 'A', basePoints: 10, assignedToId: null as string | null, ignored: 1 }

  it('lista só os campos observados que mudaram, com valor anterior e novo', () => {
    const after = { ...before, basePoints: 20, assignedToId: 'u1', ignored: 2 }

    expect(diffFields(before, after, ['title', 'basePoints', 'assignedToId'])).toEqual({
      basePoints: { from: 10, to: 20 },
      assignedToId: { from: null, to: 'u1' },
    })
  })

  it('devolve objeto vazio quando nada observado mudou', () => {
    expect(diffFields(before, { ...before, ignored: 9 }, ['title', 'basePoints'])).toEqual({})
  })
})
