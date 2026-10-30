import type { StageKind } from '#/db/schema'

const MS_PER_DAY = 86_400_000

type StageRef = { id: string; kind: StageKind; sortOrder: number }
type StageChange = { opportunityId: string; toStageId: string }

export type ConversionStep = { stageId: string; reached: number; rateFromPrevious: number | null }

export const weightedAmount = (amountCents: number, probability: number) => Math.round((amountCents * probability) / 100)

/**
 * Quem pula etapas conta como tendo passado por elas (e ganhar passa por todas as abertas);
 * sem isso a taxa de uma etapa para a seguinte poderia passar de 100%.
 */
export function computeConversion(changes: ReadonlyArray<StageChange>, stages: ReadonlyArray<StageRef>): Array<ConversionStep> {
  const open = stages.filter((s) => s.kind === 'open').sort((a, b) => a.sortOrder - b.sortOrder)
  const wonIds = new Set(stages.filter((s) => s.kind === 'won').map((s) => s.id))
  const openIndex = new Map(open.map((s, i) => [s.id, i]))

  const deepest = new Map<string, number>()
  for (const { opportunityId, toStageId } of changes) {
    const index = wonIds.has(toStageId) ? open.length - 1 : openIndex.get(toStageId)
    if (index === undefined) continue
    deepest.set(opportunityId, Math.max(deepest.get(opportunityId) ?? -1, index))
  }

  const reachedCounts = open.map((_, i) => [...deepest.values()].filter((d) => d >= i).length)
  return open.map((stage, i) => {
    const previous = reachedCounts[i - 1]
    return {
      stageId: stage.id,
      reached: reachedCounts[i]!,
      rateFromPrevious: previous ? reachedCounts[i]! / previous : null,
    }
  })
}

export const winRate = (won: number, lost: number) => (won + lost === 0 ? null : won / (won + lost))

export function averageCycleDays(won: ReadonlyArray<{ createdAt: Date; closedAt: Date }>) {
  if (won.length === 0) return null
  const totalMs = won.reduce((sum, o) => sum + (o.closedAt.getTime() - o.createdAt.getTime()), 0)
  return totalMs / won.length / MS_PER_DAY
}
