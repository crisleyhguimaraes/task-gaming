import { describe, expect, it } from 'vitest'
import { averageCycleDays, computeConversion, weightedAmount, winRate } from './funnel'

const stages = [
  { id: 'novo', kind: 'open', sortOrder: 1 },
  { id: 'qualificado', kind: 'open', sortOrder: 2 },
  { id: 'proposta', kind: 'open', sortOrder: 3 },
  { id: 'ganha', kind: 'won', sortOrder: 4 },
  { id: 'perdida', kind: 'lost', sortOrder: 5 },
] as const

const to = (opportunityId: string, toStageId: string) => ({ opportunityId, toStageId })

describe('weightedAmount', () => {
  it('aplica a probabilidade da etapa ao valor em centavos', () => {
    expect(weightedAmount(100_000, 25)).toBe(25_000)
  })

  it('arredonda para o centavo mais próximo', () => {
    expect(weightedAmount(1_001, 50)).toBe(501)
  })

  it('probabilidade zero zera o ponderado', () => {
    expect(weightedAmount(500_000, 0)).toBe(0)
  })
})

describe('computeConversion', () => {
  it('sem mudanças de etapa, ninguém alcançou nada e nenhuma taxa é calculável', () => {
    expect(computeConversion([], stages)).toEqual([
      { stageId: 'novo', reached: 0, rateFromPrevious: null },
      { stageId: 'qualificado', reached: 0, rateFromPrevious: null },
      { stageId: 'proposta', reached: 0, rateFromPrevious: null },
    ])
  })

  it('conta oportunidades distintas e calcula a passagem entre etapas consecutivas', () => {
    const changes = [
      to('a', 'novo'), to('b', 'novo'), to('c', 'novo'), to('d', 'novo'),
      to('a', 'qualificado'), to('b', 'qualificado'),
      to('a', 'proposta'),
    ]

    expect(computeConversion(changes, stages)).toEqual([
      { stageId: 'novo', reached: 4, rateFromPrevious: null },
      { stageId: 'qualificado', reached: 2, rateFromPrevious: 0.5 },
      { stageId: 'proposta', reached: 1, rateFromPrevious: 0.5 },
    ])
  })

  it('vai e volta na mesma etapa conta uma oportunidade só', () => {
    const changes = [to('a', 'novo'), to('a', 'qualificado'), to('a', 'novo'), to('a', 'qualificado')]

    const [, qualificado] = computeConversion(changes, stages)

    expect(qualificado).toEqual({ stageId: 'qualificado', reached: 1, rateFromPrevious: 1 })
  })

  it('quem pula uma etapa conta como tendo passado por ela, senão a taxa passaria de 100%', () => {
    const changes = [to('a', 'novo'), to('a', 'proposta'), to('b', 'novo')]

    expect(computeConversion(changes, stages)).toEqual([
      { stageId: 'novo', reached: 2, rateFromPrevious: null },
      { stageId: 'qualificado', reached: 1, rateFromPrevious: 0.5 },
      { stageId: 'proposta', reached: 1, rateFromPrevious: 1 },
    ])
  })

  it('ganhar conta como ter passado por todas as etapas abertas; perder não', () => {
    const changes = [to('a', 'novo'), to('a', 'ganha'), to('b', 'novo'), to('b', 'qualificado'), to('b', 'perdida')]

    expect(computeConversion(changes, stages).map((s) => s.reached)).toEqual([2, 2, 1])
  })

  it('entrar direto numa etapa posterior também conta a primeira, então não há divisão por zero', () => {
    const [novo, qualificado] = computeConversion([to('a', 'qualificado')], stages)

    expect(novo).toEqual({ stageId: 'novo', reached: 1, rateFromPrevious: null })
    expect(qualificado).toEqual({ stageId: 'qualificado', reached: 1, rateFromPrevious: 1 })
  })

  it('ignora mudanças para etapas que não existem mais na lista', () => {
    expect(computeConversion([to('a', 'fantasma')], stages).map((s) => s.reached)).toEqual([0, 0, 0])
  })

  it('respeita a ordem das etapas pelo sortOrder, não pela ordem do array', () => {
    const shuffled = [stages[2], stages[0], stages[1], stages[3], stages[4]]

    expect(computeConversion([to('a', 'novo')], shuffled).map((s) => s.stageId)).toEqual(['novo', 'qualificado', 'proposta'])
  })
})

describe('winRate', () => {
  it('é ganhas sobre ganhas mais perdidas', () => {
    expect(winRate(1, 3)).toBeCloseTo(0.25)
  })

  it('sem nada fechado não há taxa', () => {
    expect(winRate(0, 0)).toBeNull()
  })

  it('só perdas dá zero, não nulo', () => {
    expect(winRate(0, 4)).toBe(0)
  })
})

describe('averageCycleDays', () => {
  const day = 86_400_000
  const created = new Date('2026-01-01T00:00:00Z')

  it('é a média, em dias, entre criação e fechamento das ganhas', () => {
    const won = [
      { createdAt: created, closedAt: new Date(created.getTime() + 10 * day) },
      { createdAt: created, closedAt: new Date(created.getTime() + 20 * day) },
    ]

    expect(averageCycleDays(won)).toBe(15)
  })

  it('sem ganhas não há ciclo', () => {
    expect(averageCycleDays([])).toBeNull()
  })
})
