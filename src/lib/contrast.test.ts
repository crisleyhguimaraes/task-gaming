import { describe, expect, it } from 'vitest'
import { contrastRatio } from './contrast'

describe('contrastRatio', () => {
  it('preto sobre branco é 21 e a ordem dos argumentos não importa', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5)
  })

  it('cores iguais dão 1', () => {
    expect(contrastRatio('#4c5bdc', '#4c5bdc')).toBeCloseTo(1, 5)
  })

  it('o acento com texto branco passa de 4,5', () => {
    expect(contrastRatio('#ffffff', '#4c5bdc')).toBeCloseTo(5.47, 1)
  })
})
