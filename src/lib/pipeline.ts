import type { StageKind } from '#/db/schema'
import { plural } from './format'

export const defaultStages: ReadonlyArray<{ name: string; kind: StageKind; probability: number }> = [
  { name: 'Novo', kind: 'open', probability: 10 },
  { name: 'Qualificado', kind: 'open', probability: 25 },
  { name: 'Proposta', kind: 'open', probability: 50 },
  { name: 'Negociação', kind: 'open', probability: 75 },
  { name: 'Ganha', kind: 'won', probability: 100 },
  { name: 'Perdida', kind: 'lost', probability: 0 },
]

export const stageKinds: ReadonlyArray<StageKind> = ['open', 'won', 'lost']

export const missingKinds = (stages: ReadonlyArray<{ kind: StageKind }>) => stageKinds.filter((kind) => !stages.some((s) => s.kind === kind))

export type TeamPipelineLink = { teamId: string; pipelineId: string }

/** Vínculo explícito substitui o padrão do tenant; só a equipe sem vínculo cai nele. */
export function effectivePipelineIds(teamIds: ReadonlyArray<string>, links: ReadonlyArray<TeamPipelineLink>, defaultPipelineId: string) {
  const ids = teamIds.flatMap((teamId) => {
    const linked = links.filter((l) => l.teamId === teamId).map((l) => l.pipelineId)
    return linked.length ? linked : [defaultPipelineId]
  })
  return [...new Set(ids)]
}

export const countOpportunities = (n: number) => plural(n, 'oportunidade', 'oportunidades')

// toPrecision(15) descarta o ruído de ponto flutuante (1.005 * 100 = 100.49999999999999) antes de arredondar.
export const toCents = (reais: number) => Math.round(Number((reais * 100).toPrecision(15)))

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
export const formatCents = (cents: number) => brl.format(cents / 100)

export const formatRate = (rate: number | null) => (rate === null ? '—' : `${Math.round(rate * 100)}%`)
