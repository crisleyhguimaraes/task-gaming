import { and, asc, count, desc, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '#/db'
import { opportunities, pipelineStages, pipelines, teamPipelines, teams } from '#/db/schema'
import { diffFields } from '#/lib/audit'
import type { TeamPipelineLink } from '#/lib/pipeline'
import { countOpportunities, effectivePipelineIds } from '#/lib/pipeline'
import { recordAudit } from './audit.core'
import { failOnDuplicate } from './duplicate'
import type { AuthCtx } from './roles'
import { canAccessTeam, fail, requireCan } from './roles'
import { teamIdsOf } from './scope'
import { insertDefaultStages } from './stages.core'
import { assertTeamInTenant } from './teams.core'
import type { Reader, Tx } from './tx'

const MIN_NAME_LENGTH = 2
const MAX_NAME_LENGTH = 80
const DEFAULT_PIPELINE_NAME = 'Funil de vendas'
const DUPLICATE_NAME = 'Já existe um pipeline com esse nome'
const NOT_LINKED = 'O pipeline não está vinculado à equipe do lead'

export async function insertDefaultPipeline(tx: Pick<typeof db, 'insert'>, tenantId: string) {
  const [pipeline] = await tx.insert(pipelines).values({ tenantId, name: DEFAULT_PIPELINE_NAME, isDefault: true }).returning()
  await insertDefaultStages(tx, tenantId, pipeline!.id)
  return pipeline!
}

function assertValidName(name: string) {
  const length = name.trim().length
  if (length < MIN_NAME_LENGTH || length > MAX_NAME_LENGTH) fail(`O nome do pipeline precisa ter de ${MIN_NAME_LENGTH} a ${MAX_NAME_LENGTH} caracteres`)
}

const pipelineEntity = (pipelineId: string) => ({ entityType: 'pipeline', entityId: pipelineId })

/** Sempre filtra por tenant: o id vem do cliente. `lock` trava a linha até o fim da transação. */
async function loadPipeline(tx: Tx, me: AuthCtx, pipelineId: string, lock?: 'update' | 'share') {
  const query = tx.select().from(pipelines).where(and(eq(pipelines.id, pipelineId), eq(pipelines.tenantId, me.tenantId)))
  const [pipeline] = await (lock ? query.for(lock) : query)
  if (!pipeline) fail('Pipeline não encontrado')
  return pipeline
}

/** FOR SHARE espera o arquivamento em curso (e vice-versa): ninguém cria trabalho aberto num pipeline que está sendo arquivado. */
export async function lockOpenPipeline(tx: Tx, me: AuthCtx, pipelineId: string) {
  const pipeline = await loadPipeline(tx, me, pipelineId, 'share')
  if (pipeline.archivedAt) fail('Pipeline arquivado')
  return pipeline
}

async function openOpportunitiesIn(tx: Reader, pipelineId: string, teamId?: string) {
  const [row] = await tx
    .select({ n: count() })
    .from(opportunities)
    .innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId))
    .where(and(eq(opportunities.pipelineId, pipelineId), eq(pipelineStages.kind, 'open'), teamId ? eq(opportunities.teamId, teamId) : undefined))
  return row!.n
}

export async function createPipelineFor(me: AuthCtx, name: string) {
  requireCan(me, 'pipeline.configure')
  assertValidName(name)
  return db.transaction(async (tx) => {
    const [pipeline] = await failOnDuplicate(DUPLICATE_NAME, tx.insert(pipelines).values({ tenantId: me.tenantId, name: name.trim() }).returning())
    await insertDefaultStages(tx, me.tenantId, pipeline!.id)
    await recordAudit(tx, me, { action: 'pipeline.created', ...pipelineEntity(pipeline!.id), meta: { name: pipeline!.name } })
    return pipeline!
  })
}

export async function renamePipelineFor(me: AuthCtx, pipelineId: string, name: string) {
  requireCan(me, 'pipeline.configure')
  assertValidName(name)
  return db.transaction(async (tx) => {
    const pipeline = await loadPipeline(tx, me, pipelineId, 'update')
    const [renamed] = await failOnDuplicate(DUPLICATE_NAME, tx.update(pipelines).set({ name: name.trim() }).where(eq(pipelines.id, pipeline.id)).returning())
    const changes = diffFields(pipeline, renamed!, ['name'])
    if (Object.keys(changes).length) await recordAudit(tx, me, { action: 'pipeline.updated', ...pipelineEntity(pipeline.id), changes })
    return renamed!
  })
}

export async function archivePipelineFor(me: AuthCtx, pipelineId: string) {
  requireCan(me, 'pipeline.configure')
  await db.transaction(async (tx) => {
    const pipeline = await loadPipeline(tx, me, pipelineId, 'update')
    if (pipeline.isDefault) fail('O pipeline padrão não pode ser arquivado')
    if (pipeline.archivedAt) fail('O pipeline já está arquivado')
    const open = await openOpportunitiesIn(tx, pipeline.id)
    if (open > 0) fail(`O pipeline tem ${countOpportunities(open)} em etapa aberta; mova ou feche antes de arquivar`)
    await tx.update(pipelines).set({ archivedAt: new Date() }).where(eq(pipelines.id, pipeline.id))
    await recordAudit(tx, me, { action: 'pipeline.archived', ...pipelineEntity(pipeline.id), meta: { name: pipeline.name } })
  })
}

export async function restorePipelineFor(me: AuthCtx, pipelineId: string) {
  requireCan(me, 'pipeline.configure')
  await db.transaction(async (tx) => {
    const pipeline = await loadPipeline(tx, me, pipelineId, 'update')
    if (!pipeline.archivedAt) fail('O pipeline não está arquivado')
    await failOnDuplicate(DUPLICATE_NAME, tx.update(pipelines).set({ archivedAt: null }).where(eq(pipelines.id, pipeline.id)))
    await recordAudit(tx, me, { action: 'pipeline.restored', ...pipelineEntity(pipeline.id), meta: { name: pipeline.name } })
  })
}

async function defaultPipelineIdOf(tx: Reader, tenantId: string) {
  const [standard] = await tx.select({ id: pipelines.id }).from(pipelines).where(and(eq(pipelines.tenantId, tenantId), eq(pipelines.isDefault, true)))
  if (!standard) fail('O tenant não tem pipeline padrão')
  return standard.id
}

/** Vínculos com pipeline ativo: quem só tem vínculo com arquivado vale como sem vínculo. */
function linksOfTeams(tx: Reader, tenantId: string, teamIds: ReadonlyArray<string>): Promise<Array<TeamPipelineLink>> {
  if (!teamIds.length) return Promise.resolve([])
  return tx
    .select({ teamId: teamPipelines.teamId, pipelineId: teamPipelines.pipelineId })
    .from(teamPipelines)
    .innerJoin(pipelines, eq(pipelines.id, teamPipelines.pipelineId))
    .where(and(eq(teamPipelines.tenantId, tenantId), inArray(teamPipelines.teamId, [...teamIds]), isNull(pipelines.archivedAt)))
}

async function effectivePipelineIdsOf(tx: Reader, tenantId: string, teamIds: ReadonlyArray<string>) {
  if (!teamIds.length) return []
  return effectivePipelineIds(teamIds, await linksOfTeams(tx, tenantId, teamIds), await defaultPipelineIdOf(tx, tenantId))
}

/** Admin vê todos (inclusive arquivados) com o padrão primeiro; os demais, os efetivos das equipes que enxergam. */
export async function listPipelinesFor(me: AuthCtx) {
  const teamIds = teamIdsOf(me)
  const visibleIds = teamIds === 'all' ? null : await effectivePipelineIdsOf(db, me.tenantId, teamIds)
  if (visibleIds?.length === 0) return []
  return db
    .select()
    .from(pipelines)
    .where(and(eq(pipelines.tenantId, me.tenantId), visibleIds ? inArray(pipelines.id, visibleIds) : undefined))
    .orderBy(desc(pipelines.isDefault), asc(pipelines.name))
}

/** A lista de `listPipelinesFor` com as equipes vinculadas de cada pipeline (as sem vínculo usam o padrão e não aparecem nele). */
export async function listPipelinesWithTeamsFor(me: AuthCtx) {
  const visible = await listPipelinesFor(me)
  if (!visible.length) return []
  const links = await db
    .select({ pipelineId: teamPipelines.pipelineId, id: teams.id, name: teams.name })
    .from(teamPipelines)
    .innerJoin(teams, eq(teams.id, teamPipelines.teamId))
    .where(inArray(teamPipelines.pipelineId, visible.map((p) => p.id)))
    .orderBy(asc(teams.name))
  return visible.map(({ id, name, isDefault, archivedAt }) => ({
    id,
    name,
    isDefault,
    archivedAt,
    teams: links.filter((l) => l.pipelineId === id).map((l) => ({ id: l.id, name: l.name })),
  }))
}

/** Onde a equipe pode abrir oportunidade hoje: os vínculos ativos ou, sem eles, o padrão. */
export async function pipelinesOfTeamFor(me: AuthCtx, teamId: string) {
  await assertTeamInTenant(db, me.tenantId, teamId)
  if (!canAccessTeam(me, teamId)) fail('Equipe não encontrada')
  const ids = await effectivePipelineIdsOf(db, me.tenantId, [teamId])
  return db
    .select({ id: pipelines.id, name: pipelines.name })
    .from(pipelines)
    .where(and(eq(pipelines.tenantId, me.tenantId), inArray(pipelines.id, ids), isNull(pipelines.archivedAt)))
    .orderBy(desc(pipelines.isDefault), asc(pipelines.name))
}

/**
 * Em que pipeline a equipe do lead cria a oportunidade. Trava o pipeline e, se o acesso vem de um vínculo, o vínculo:
 * desvincular e arquivar esperam esta transação, e depois dela enxergam a oportunidade nova.
 */
export async function lockPipelineForTeam(tx: Tx, me: AuthCtx, teamId: string, requestedId?: string) {
  const links = await linksOfTeams(tx, me.tenantId, [teamId])
  const effective = effectivePipelineIds([teamId], links, await defaultPipelineIdOf(tx, me.tenantId))
  const [first, ...others] = effective
  if (!requestedId && others.length) fail('Escolha o pipeline')
  const pipeline = await lockOpenPipeline(tx, me, requestedId ?? first!)
  if (!effective.includes(pipeline.id)) fail(NOT_LINKED)
  if (links.some((l) => l.pipelineId === pipeline.id)) await lockLink(tx, pipeline.id, teamId)
  return pipeline.id
}

async function lockLink(tx: Tx, pipelineId: string, teamId: string) {
  const [link] = await tx
    .select({ teamId: teamPipelines.teamId })
    .from(teamPipelines)
    .where(and(eq(teamPipelines.pipelineId, pipelineId), eq(teamPipelines.teamId, teamId)))
    .for('share')
  if (!link) fail(NOT_LINKED)
}

export async function linkTeamToPipelineFor(me: AuthCtx, pipelineId: string, teamId: string) {
  requireCan(me, 'team.link', teamId)
  await db.transaction(async (tx) => {
    const pipeline = await lockOpenPipeline(tx, me, pipelineId)
    await assertTeamInTenant(tx, me.tenantId, teamId)
    const linked = await tx.insert(teamPipelines).values({ pipelineId: pipeline.id, teamId, tenantId: me.tenantId }).onConflictDoNothing().returning()
    if (!linked.length) return
    await recordAudit(tx, me, { action: 'pipeline.team_linked', ...pipelineEntity(pipeline.id), meta: { teamId, name: pipeline.name } })
  })
}

/** Apaga o vínculo antes de contar: quem criou oportunidade segurando o vínculo já terminou, e a contagem a enxerga. */
export async function unlinkTeamFromPipelineFor(me: AuthCtx, pipelineId: string, teamId: string) {
  requireCan(me, 'team.link', teamId)
  await db.transaction(async (tx) => {
    const pipeline = await loadPipeline(tx, me, pipelineId)
    const removed = await tx
      .delete(teamPipelines)
      .where(and(eq(teamPipelines.pipelineId, pipeline.id), eq(teamPipelines.teamId, teamId), eq(teamPipelines.tenantId, me.tenantId)))
      .returning()
    if (!removed.length) return
    const open = await openOpportunitiesIn(tx, pipeline.id, teamId)
    if (open > 0) fail(`A equipe tem ${countOpportunities(open)} em etapa aberta neste pipeline; mova ou feche antes de desvincular`)
    await recordAudit(tx, me, { action: 'pipeline.team_unlinked', ...pipelineEntity(pipeline.id), meta: { teamId, name: pipeline.name } })
  })
}
