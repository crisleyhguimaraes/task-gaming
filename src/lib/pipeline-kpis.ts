import type { StageKind } from '#/db/schema'

export type KpiColumn = { kind: StageKind; amountCents: number; weightedCents: number; opportunities: ReadonlyArray<unknown> }

export function pipelineKpis(columns: ReadonlyArray<KpiColumn>, funnel: { winRate: number | null; averageCycleDays: number | null }) {
  const open = columns.filter((c) => c.kind === 'open')
  return {
    openCents: open.reduce((sum, c) => sum + c.amountCents, 0),
    forecastCents: open.reduce((sum, c) => sum + c.weightedCents, 0),
    openCount: open.reduce((sum, c) => sum + c.opportunities.length, 0),
    winRate: funnel.winRate,
    averageCycleDays: funnel.averageCycleDays,
  }
}
