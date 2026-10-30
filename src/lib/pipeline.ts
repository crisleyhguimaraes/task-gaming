import type { StageKind } from '#/db/schema'

export const defaultStages: ReadonlyArray<{ name: string; kind: StageKind; probability: number }> = [
  { name: 'Novo', kind: 'open', probability: 10 },
  { name: 'Qualificado', kind: 'open', probability: 25 },
  { name: 'Proposta', kind: 'open', probability: 50 },
  { name: 'Negociação', kind: 'open', probability: 75 },
  { name: 'Ganha', kind: 'won', probability: 100 },
  { name: 'Perdida', kind: 'lost', probability: 0 },
]
