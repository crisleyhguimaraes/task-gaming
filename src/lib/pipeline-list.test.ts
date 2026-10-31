import { describe, expect, it } from 'vitest'
import { dealRows } from './pipeline-list'

const stage = (name: string, kind: 'open' | 'won' | 'lost', titles: Array<string>) => ({
  name,
  kind,
  opportunities: titles.map((title) => ({ id: title, title })),
})

describe('dealRows', () => {
  it('une os negócios na ordem das etapas, cada um com o nome e o tipo da sua etapa', () => {
    const rows = dealRows([stage('Novo', 'open', ['A', 'B']), stage('Ganha', 'won', ['C'])])

    expect(rows.map((r) => [r.title, r.stageName, r.stageKind])).toEqual([
      ['A', 'Novo', 'open'],
      ['B', 'Novo', 'open'],
      ['C', 'Ganha', 'won'],
    ])
  })

  it('etapas sem negócio não geram linha e sem etapas a lista é vazia', () => {
    expect(dealRows([stage('Novo', 'open', [])])).toEqual([])
    expect(dealRows([])).toEqual([])
  })
})
