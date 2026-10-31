import type { StageKind } from '#/db/schema'

type StageWithDeals<TDeal> = { name: string; kind: StageKind; opportunities: ReadonlyArray<TDeal> }

/** A visão em lista mostra os negócios de todas as etapas numa tabela só, na ordem do funil. */
export const dealRows = <TDeal>(stages: ReadonlyArray<StageWithDeals<TDeal>>) =>
  stages.flatMap((stage) => stage.opportunities.map((deal) => ({ ...deal, stageName: stage.name, stageKind: stage.kind })))
