import { describe, expect, it } from 'vitest'
import { defaultStages, formatCents, missingKinds, toCents } from './pipeline'

describe('missingKinds', () => {
  it('as etapas padrão cobrem aberta, ganha e perdida', () => {
    expect(missingKinds(defaultStages)).toEqual([])
  })

  it('aponta o que falta quando a lista perde um tipo', () => {
    expect(missingKinds([{ kind: 'open' }, { kind: 'won' }])).toEqual(['lost'])
  })

  it('lista vazia não tem nenhum dos três', () => {
    expect(missingKinds([])).toEqual(['open', 'won', 'lost'])
  })
})

describe('toCents', () => {
  it('converte reais com centavos sem sobra de ponto flutuante', () => {
    expect(toCents(19.99)).toBe(1999)
    expect(toCents(1.005)).toBe(101)
    expect(toCents(0.1 + 0.2)).toBe(30)
  })

  it('zero é zero', () => {
    expect(toCents(0)).toBe(0)
  })
})

describe('formatCents', () => {
  it('formata em reais no padrão brasileiro', () => {
    expect(formatCents(123_456)).toMatch(/^R\$\s1\.234,56$/)
  })
})
