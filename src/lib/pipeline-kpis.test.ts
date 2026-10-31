import { describe, expect, it } from 'vitest'
import { pipelineKpis } from './pipeline-kpis'

const column = (kind: 'open' | 'won' | 'lost', amountCents: number, weightedCents: number, count: number) => ({
  kind,
  amountCents,
  weightedCents,
  opportunities: Array.from({ length: count }),
})

describe('pipelineKpis', () => {
  it('soma só as etapas abertas', () => {
    const kpis = pipelineKpis([column('open', 1000, 250, 2), column('open', 500, 250, 1), column('won', 9000, 9000, 4), column('lost', 700, 0, 1)], { winRate: 0.8, averageCycleDays: 12 })

    expect(kpis).toEqual({ openCents: 1500, forecastCents: 500, openCount: 3, winRate: 0.8, averageCycleDays: 12 })
  })

  it('sem etapas abertas tudo é zero e a taxa e o ciclo seguem do funil', () => {
    expect(pipelineKpis([column('won', 10, 10, 1)], { winRate: null, averageCycleDays: null })).toEqual({ openCents: 0, forecastCents: 0, openCount: 0, winRate: null, averageCycleDays: null })
  })
})
