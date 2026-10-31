import { describe, expect, it } from 'vitest'
import { countOpportunities, defaultStages, effectivePipelineIds, formatCents, missingKinds, toCents } from './pipeline'

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

describe('effectivePipelineIds', () => {
  const standard = 'p-padrao'
  const links = [
    { teamId: 'a', pipelineId: 'p-a' },
    { teamId: 'b', pipelineId: 'p-b' },
    { teamId: 'b', pipelineId: 'p-comum' },
    { teamId: 'c', pipelineId: 'p-comum' },
  ]

  it('equipe sem vínculo usa o padrão do tenant', () => {
    expect(effectivePipelineIds(['sem-vinculo'], links, standard)).toEqual([standard])
  })

  it('vínculo explícito substitui o padrão', () => {
    expect(effectivePipelineIds(['a'], links, standard)).toEqual(['p-a'])
  })

  it('várias equipes somam os vínculos, sem repetir o pipeline compartilhado', () => {
    expect(effectivePipelineIds(['b', 'c'], links, standard)).toEqual(['p-b', 'p-comum'])
  })

  it('equipe vinculada e equipe sem vínculo: o padrão entra ao lado do vinculado', () => {
    expect(effectivePipelineIds(['a', 'sem-vinculo'], links, standard)).toEqual(['p-a', standard])
  })

  it('sem equipe não há pipeline efetivo', () => {
    expect(effectivePipelineIds([], links, standard)).toEqual([])
  })
})

describe('countOpportunities', () => {
  it('concorda o plural com a quantidade', () => {
    expect(countOpportunities(1)).toBe('1 oportunidade')
    expect(countOpportunities(0)).toBe('0 oportunidades')
    expect(countOpportunities(2)).toBe('2 oportunidades')
  })
})
