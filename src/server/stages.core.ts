import { and, asc, eq, getTableColumns, sql } from 'drizzle-orm'
import { db } from '#/db'
import type { StageKind } from '#/db/schema'
import { pipelineStages } from '#/db/schema'
import { diffFields } from '#/lib/audit'
import { defaultStages, missingKinds } from '#/lib/pipeline'
import { calculateNewOrder } from '#/lib/order'
import { recordAudit } from './audit.core'
import type { AuthCtx } from './roles'
import { fail, requireCan } from './roles'
import type { Reader, Tx } from './tx'
import { assertValidName } from './validation'

const MAX_NAME_LENGTH = 60
const MAX_PROBABILITY = 100

const kindLabel: Record<StageKind, string> = { open: 'aberta', won: 'ganha', lost: 'perdida' }

export async function insertDefaultStages(tx: Pick<typeof db, 'insert'>, tenantId: string, pipelineId: string) {
  await tx.insert(pipelineStages).values(defaultStages.map((stage, i) => ({ tenantId, pipelineId, ...stage, sortOrder: i + 1 })))
}

// Nomes de tabela escritos à mão: numa query de uma tabela só o Drizzle omite o prefixo das colunas e a subconsulta compararia a tabela interna consigo mesma.
// Aparecer em opportunity_stage_changes basta: o histórico e o funil dependem dessa etapa existir.
const wasUsed = sql<boolean>`(
  exists (select 1 from opportunities o where o.stage_id = pipeline_stages.id)
  or exists (select 1 from opportunity_stage_changes c where c.from_stage_id = pipeline_stages.id or c.to_stage_id = pipeline_stages.id)
)`

const stagesOf = (tx: Reader, tenantId: string, pipelineId: string) =>
  tx
    .select({ ...getTableColumns(pipelineStages), inUse: wasUsed })
    .from(pipelineStages)
    .where(and(eq(pipelineStages.tenantId, tenantId), eq(pipelineStages.pipelineId, pipelineId)))
    .orderBy(asc(pipelineStages.sortOrder))

export const listStagesFor = (me: AuthCtx, pipelineId: string) => stagesOf(db, me.tenantId, pipelineId)

/** Trava as etapas do pipeline: duas edições simultâneas não conseguem, juntas, violar "ao menos uma de cada tipo". */
const lockStagesOf = (tx: Tx, tenantId: string, pipelineId: string) => stagesOf(tx, tenantId, pipelineId).for('update')

type StageRow = Awaited<ReturnType<typeof listStagesFor>>[number]

function assertValidProbability(probability: number) {
  if (!Number.isInteger(probability) || probability < 0 || probability > MAX_PROBABILITY) fail(`Probabilidade deve ser um inteiro entre 0 e ${MAX_PROBABILITY}`)
}

function assertKindsCovered(stages: ReadonlyArray<{ kind: StageKind }>) {
  const [missing] = missingKinds(stages)
  if (missing) fail(`O pipeline precisa de ao menos uma etapa ${kindLabel[missing]}`)
}

function findStage(stages: ReadonlyArray<StageRow>, stageId: string) {
  const stage = stages.find((s) => s.id === stageId)
  if (!stage) fail('Etapa não encontrada')
  return stage
}

const stageEntity = (stageId: string) => ({ entityType: 'pipeline_stage', entityId: stageId })

/** Lê a etapa pelo tenant e trava todas as do pipeline dela; a etapa apagada no meio do caminho vira "não encontrada". */
async function lockPipelineOfStage(tx: Tx, me: AuthCtx, stageId: string) {
  const [found] = await tx.select({ pipelineId: pipelineStages.pipelineId }).from(pipelineStages).where(and(eq(pipelineStages.id, stageId), eq(pipelineStages.tenantId, me.tenantId)))
  if (!found) fail('Etapa não encontrada')
  const stages = await lockStagesOf(tx, me.tenantId, found.pipelineId)
  return { stages, stage: findStage(stages, stageId) }
}

export type NewStage = { pipelineId: string; name: string; kind: StageKind; probability: number }

export async function createStageFor(me: AuthCtx, data: NewStage) {
  requireCan(me, 'pipeline.configure')
  assertValidName(data.name, 'da etapa', MAX_NAME_LENGTH)
  assertValidProbability(data.probability)
  return db.transaction(async (tx) => {
    const stages = await lockStagesOf(tx, me.tenantId, data.pipelineId)
    if (!stages.length) fail('Pipeline não encontrado')
    const lastOfKind = stages.filter((s) => s.kind === data.kind).at(-1)
    const following = stages.find((s) => lastOfKind && s.sortOrder > lastOfKind.sortOrder)
    const [stage] = await tx
      .insert(pipelineStages)
      .values({ tenantId: me.tenantId, ...data, name: data.name.trim(), sortOrder: calculateNewOrder(lastOfKind?.sortOrder ?? null, following?.sortOrder ?? null) })
      .returning()
    await recordAudit(tx, me, { action: 'pipeline.stage_created', ...stageEntity(stage!.id), meta: { pipelineId: data.pipelineId, name: stage!.name, kind: stage!.kind, probability: stage!.probability } })
    return stage!
  })
}

async function saveStageChanges(tx: Tx, me: AuthCtx, before: StageRow, patch: Partial<typeof pipelineStages.$inferInsert>) {
  const [after] = await tx.update(pipelineStages).set(patch).where(eq(pipelineStages.id, before.id)).returning()
  const changes = diffFields(before, after!, ['name', 'kind', 'probability', 'sortOrder'])
  if (Object.keys(changes).length) await recordAudit(tx, me, { action: 'pipeline.stage_updated', ...stageEntity(before.id), changes, meta: { pipelineId: before.pipelineId } })
  return after!
}

export type StageEdit = Partial<Omit<NewStage, 'pipelineId'>>

export async function updateStageFor(me: AuthCtx, stageId: string, data: StageEdit) {
  requireCan(me, 'pipeline.configure')
  if (data.name !== undefined) assertValidName(data.name, 'da etapa', MAX_NAME_LENGTH)
  if (data.probability !== undefined) assertValidProbability(data.probability)
  return db.transaction(async (tx) => {
    const { stages, stage } = await lockPipelineOfStage(tx, me, stageId)
    if (data.kind && data.kind !== stage.kind) {
      if (stage.inUse) fail('Etapa já foi usada e não pode mudar de tipo')
      assertKindsCovered(stages.map((s) => (s.id === stageId ? { kind: data.kind! } : s)))
    }
    return saveStageChanges(tx, me, stage, { name: data.name?.trim(), kind: data.kind, probability: data.probability })
  })
}

export async function reorderStageFor(me: AuthCtx, stageId: string, sortOrder: number) {
  requireCan(me, 'pipeline.configure')
  if (!Number.isFinite(sortOrder)) fail('Posição inválida')
  return db.transaction(async (tx) => {
    const { stage } = await lockPipelineOfStage(tx, me, stageId)
    return saveStageChanges(tx, me, stage, { sortOrder })
  })
}

export async function deleteStageFor(me: AuthCtx, stageId: string) {
  requireCan(me, 'pipeline.configure')
  await db.transaction(async (tx) => {
    const { stages, stage } = await lockPipelineOfStage(tx, me, stageId)
    if (stage.inUse) fail('Etapa já foi usada e não pode ser excluída')
    assertKindsCovered(stages.filter((s) => s.id !== stageId))
    await tx.delete(pipelineStages).where(eq(pipelineStages.id, stageId))
    await recordAudit(tx, me, { action: 'pipeline.stage_deleted', ...stageEntity(stageId), meta: { pipelineId: stage.pipelineId, name: stage.name, kind: stage.kind } })
  })
}
