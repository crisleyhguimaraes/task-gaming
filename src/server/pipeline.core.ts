import { and, asc, count, eq, gte, isNotNull, lte, max } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db } from '#/db'
import type { AuditMeta, LeadStatus } from '#/db/schema'
import { leads, opportunities, opportunityStageChanges, pipelineStages, tasks, teams, users } from '#/db/schema'
import { diffFields } from '#/lib/audit'
import { averageCycleDays, computeConversion, weightedAmount, winRate } from '#/lib/funnel'
import { calculateNewOrder } from '#/lib/order'
import type { MoveOptions, Owned } from '#/lib/opportunity'
import { canEditRecord, canSeeRecord, lostReasonFor, planMove } from '#/lib/opportunity'
import { recordAudit } from './audit.core'
import type { AuthCtx } from './roles'
import { can, fail, forbid, isAdmin, requireCan } from './roles'
import { assertMember, inTeams, usersInScope } from './scope'
import { lockOpenPipeline, lockPipelineForTeam } from './pipelines.core'
import { listStagesFor } from './stages.core'
import type { Tx } from './tx'

const MIN_TITLE_LENGTH = 2
const QUALIFIED: LeadStatus = 'qualified'

/** Sem `pipelineId`, a equipe do lead tem de ter um único pipeline efetivo. */
export type OpportunityData = { title: string; amountCents: number; expectedCloseDate?: string | null; ownerId?: string | null; pipelineId?: string }
export type OpportunityEdit = { title: string; amountCents: number; expectedCloseDate: string | null; ownerId: string | null }

const canWriteOpportunity = (me: AuthCtx, record: Owned) => can(me, 'opportunity.write', record.teamId) && canEditRecord(me, record)

function assertValidFields({ title, amountCents }: Pick<OpportunityData, 'title' | 'amountCents'>) {
  if (title.trim().length < MIN_TITLE_LENGTH) fail(`O título precisa ter ao menos ${MIN_TITLE_LENGTH} caracteres`)
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) fail('O valor deve ser um inteiro em centavos, maior ou igual a zero')
}

async function loadLead(tx: Tx, me: AuthCtx, leadId: string) {
  const [lead] = await tx.select().from(leads).where(and(eq(leads.id, leadId), eq(leads.tenantId, me.tenantId))).for('update')
  if (!lead || !canSeeRecord(me, lead)) fail('Lead não encontrado')
  return lead
}

/** Trava a linha: dois movimentos simultâneos viram uma fila, e cada mudança de etapa sai da etapa em que a anterior terminou. */
async function loadOpportunity(tx: Tx, me: AuthCtx, opportunityId: string) {
  const [opp] = await tx.select().from(opportunities).where(and(eq(opportunities.id, opportunityId), eq(opportunities.tenantId, me.tenantId))).for('update')
  if (!opp || !canSeeRecord(me, opp)) fail('Oportunidade não encontrada')
  return opp
}

async function endOfStage(tx: Tx, stageId: string) {
  const [row] = await tx.select({ last: max(opportunities.sortOrder) }).from(opportunities).where(eq(opportunities.stageId, stageId))
  return calculateNewOrder(row?.last ?? null, null)
}

async function insertOpportunity(tx: Tx, me: AuthCtx, lead: { id: string; teamId: string }, data: OpportunityData, now = new Date()) {
  assertValidFields(data)
  const ownerId = data.ownerId ?? null
  if (ownerId) await assertMember(tx, { tenantId: me.tenantId, userId: ownerId, teamId: lead.teamId })
  const pipelineId = await lockPipelineForTeam(tx, me, lead.teamId, data.pipelineId)
  const [firstOpen] = await tx
    .select()
    .from(pipelineStages)
    .where(and(eq(pipelineStages.pipelineId, pipelineId), eq(pipelineStages.kind, 'open')))
    .orderBy(asc(pipelineStages.sortOrder))
    .limit(1)
  if (!firstOpen) fail('O pipeline não tem etapa aberta')
  const [opp] = await tx
    .insert(opportunities)
    .values({
      tenantId: me.tenantId,
      teamId: lead.teamId,
      leadId: lead.id,
      ownerId,
      title: data.title.trim(),
      amountCents: data.amountCents,
      expectedCloseDate: data.expectedCloseDate ?? null,
      pipelineId,
      stageId: firstOpen.id,
      sortOrder: await endOfStage(tx, firstOpen.id),
      createdById: me.userId,
      createdAt: now,
    })
    .returning()
  await tx.insert(opportunityStageChanges).values({ tenantId: me.tenantId, opportunityId: opp!.id, fromStageId: null, toStageId: firstOpen.id, changedById: me.userId, changedAt: now })
  await recordAudit(tx, me, {
    action: 'opportunity.created',
    entityType: 'opportunity',
    entityId: opp!.id,
    meta: { title: opp!.title, leadId: lead.id, amountCents: opp!.amountCents, pipelineId, stage: firstOpen.name },
  })
  return opp!
}

export async function createOpportunityFor(me: AuthCtx, leadId: string, data: OpportunityData, now = new Date()) {
  return db.transaction(async (tx) => {
    const lead = await loadLead(tx, me, leadId)
    requireCan(me, 'opportunity.write', lead.teamId)
    return insertOpportunity(tx, me, lead, data, now)
  })
}

/** Cria a oportunidade e qualifica o lead na mesma transação: nunca um sem o outro. */
export async function convertLeadFor(me: AuthCtx, leadId: string, data: OpportunityData) {
  return db.transaction(async (tx) => {
    const lead = await loadLead(tx, me, leadId)
    requireCan(me, 'lead.write', lead.teamId)
    if (!canWriteOpportunity(me, lead)) forbid()
    if (lead.status !== QUALIFIED) {
      await tx.update(leads).set({ status: QUALIFIED }).where(eq(leads.id, lead.id))
      await recordAudit(tx, me, { action: 'lead.updated', entityType: 'lead', entityId: lead.id, changes: { status: { from: lead.status, to: QUALIFIED } } })
    }
    return insertOpportunity(tx, me, lead, { ...data, ownerId: data.ownerId === undefined ? lead.ownerId : data.ownerId })
  })
}

export async function updateOpportunityFor(me: AuthCtx, opportunityId: string, data: OpportunityEdit) {
  assertValidFields(data)
  return db.transaction(async (tx) => {
    const opp = await loadOpportunity(tx, me, opportunityId)
    if (!canWriteOpportunity(me, opp)) forbid()
    if (data.ownerId && data.ownerId !== opp.ownerId) await assertMember(tx, { tenantId: me.tenantId, userId: data.ownerId, teamId: opp.teamId })
    const [updated] = await tx
      .update(opportunities)
      .set({ title: data.title.trim(), amountCents: data.amountCents, expectedCloseDate: data.expectedCloseDate, ownerId: data.ownerId })
      .where(eq(opportunities.id, opp.id))
      .returning()
    const changes = diffFields(opp, updated!, ['title', 'amountCents', 'expectedCloseDate', 'ownerId'])
    if (Object.keys(changes).length) await recordAudit(tx, me, { action: 'opportunity.updated', entityType: 'opportunity', entityId: opp.id, changes })
    return updated!
  })
}

export async function moveOpportunityFor(me: AuthCtx, opportunityId: string, toStageId: string, options: MoveOptions = {}, now?: Date) {
  if (options.sortOrder !== undefined && !Number.isFinite(options.sortOrder)) fail('Posição inválida')
  return db.transaction(async (tx) => {
    const opp = await loadOpportunity(tx, me, opportunityId)
    // O relógio padrão só é lido depois do lock da linha: assim `changedAt` segue a ordem em que os movimentos simultâneos entram na fila.
    const at = now ?? new Date()
    if (!canWriteOpportunity(me, opp)) forbid()
    const stages = await tx.select().from(pipelineStages).where(eq(pipelineStages.pipelineId, opp.pipelineId))
    const target = stages.find((s) => s.id === toStageId)
    const current = stages.find((s) => s.id === opp.stageId)
    if (!target || !current) fail('Etapa não encontrada')

    const plan = planMove(current, target, options, at)
    if (plan.type === 'unchanged') return opp
    if (plan.type === 'reorder') {
      const [reordered] = await tx.update(opportunities).set({ sortOrder: plan.sortOrder }).where(eq(opportunities.id, opp.id)).returning()
      return reordered!
    }

    if (plan.reopens) requireCan(me, 'opportunity.reopen', opp.teamId)
    if (target.kind === 'open' && current.kind !== 'open') await lockOpenPipeline(tx, me, opp.pipelineId)
    const lostReason = lostReasonFor(target, options.lostReason)
    const [moved] = await tx
      .update(opportunities)
      .set({ stageId: target.id, sortOrder: options.sortOrder ?? (await endOfStage(tx, target.id)), closedAt: plan.closedAt, lostReason })
      .where(eq(opportunities.id, opp.id))
      .returning()
    await tx.insert(opportunityStageChanges).values({ tenantId: me.tenantId, opportunityId: opp.id, fromStageId: current.id, toStageId: target.id, changedById: me.userId, changedAt: at })
    const meta: AuditMeta = { fromStage: current.name, toStage: target.name, ...(lostReason ? { lostReason } : {}) }
    await recordAudit(tx, me, { action: plan.action, entityType: 'opportunity', entityId: opp.id, changes: diffFields(opp, moved!, ['stageId']), meta })
    return moved!
  })
}

/** Pipeline de outro tenant ou inexistente não tem etapas: é "não encontrado", nunca uma lista vazia. */
async function stagesOfPipeline(me: AuthCtx, pipelineId: string) {
  const stages = await db
    .select()
    .from(pipelineStages)
    .where(and(eq(pipelineStages.tenantId, me.tenantId), eq(pipelineStages.pipelineId, pipelineId)))
    .orderBy(asc(pipelineStages.sortOrder))
  if (!stages.length) fail('Pipeline não encontrado')
  return stages
}

export type PipelineFilters = { pipelineId: string; teamId?: string; ownerId?: string }

// NOTE: carrega todas as oportunidades do recorte, inclusive as fechadas; passando de alguns milhares, limitar as colunas ganha/perdida aos últimos N dias.
export async function listPipelineFor(me: AuthCtx, filters: PipelineFilters) {
  const [stages, rows] = await Promise.all([
    stagesOfPipeline(me, filters.pipelineId),
    db
      .select({
        id: opportunities.id,
        title: opportunities.title,
        amountCents: opportunities.amountCents,
        expectedCloseDate: opportunities.expectedCloseDate,
        stageId: opportunities.stageId,
        teamId: opportunities.teamId,
        ownerId: opportunities.ownerId,
        ownerName: users.name,
        leadName: leads.name,
        sortOrder: opportunities.sortOrder,
      })
      .from(opportunities)
      .innerJoin(leads, eq(leads.id, opportunities.leadId))
      .leftJoin(users, eq(users.id, opportunities.ownerId))
      .where(
        and(
          eq(opportunities.tenantId, me.tenantId),
          eq(opportunities.pipelineId, filters.pipelineId),
          inTeams(opportunities.teamId, me, { only: filters.teamId }),
          filters.ownerId ? eq(opportunities.ownerId, filters.ownerId) : undefined,
        ),
      )
      .orderBy(asc(opportunities.sortOrder), asc(opportunities.createdAt), asc(opportunities.id)),
  ])
  return stages.map((stage) => {
    const cards = rows.filter((r) => r.stageId === stage.id).map((r) => ({ ...r, canWrite: canWriteOpportunity(me, r) }))
    const amountCents = cards.reduce((sum, c) => sum + c.amountCents, 0)
    return { ...stage, count: cards.length, amountCents, weightedCents: weightedAmount(amountCents, stage.probability), opportunities: cards }
  })
}

export async function pipelineFiltersFor(me: AuthCtx, teamId?: string) {
  const [teamList, owners] = await Promise.all([
    isAdmin(me) ? db.select({ id: teams.id, name: teams.name }).from(teams).where(eq(teams.tenantId, me.tenantId)).orderBy(asc(teams.name)) : [],
    db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(usersInScope(me, { only: isAdmin(me) ? teamId : undefined }))
      .orderBy(asc(users.name)),
  ])
  return { teams: teamList, owners }
}

export type FunnelFilters = { pipelineId: string; from: Date; to: Date; teamId?: string }

// NOTE: agrega em memória as linhas do período; passando de dezenas de milhares de oportunidades, mover a contagem para group by no SQL.
/** Conversão olha a coorte criada no período; taxa de ganho e ciclo olham o que fechou no período. */
export async function funnelFor(me: AuthCtx, { pipelineId, from, to, teamId }: FunnelFilters) {
  const scope = and(eq(opportunities.tenantId, me.tenantId), eq(opportunities.pipelineId, pipelineId), inTeams(opportunities.teamId, me, { only: teamId }))
  const createdInPeriod = and(scope, gte(opportunities.createdAt, from), lte(opportunities.createdAt, to))
  const [stages, [cohort], changes, closed] = await Promise.all([
    stagesOfPipeline(me, pipelineId),
    db.select({ n: count() }).from(opportunities).where(createdInPeriod),
    db
      .select({ opportunityId: opportunityStageChanges.opportunityId, toStageId: opportunityStageChanges.toStageId })
      .from(opportunityStageChanges)
      .innerJoin(opportunities, eq(opportunities.id, opportunityStageChanges.opportunityId))
      .where(createdInPeriod),
    db
      .select({ kind: pipelineStages.kind, createdAt: opportunities.createdAt, closedAt: opportunities.closedAt })
      .from(opportunities)
      .innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId))
      .where(and(scope, isNotNull(opportunities.closedAt), gte(opportunities.closedAt, from), lte(opportunities.closedAt, to))),
  ])
  const names = new Map(stages.map((s) => [s.id, s.name]))
  const won = closed.filter((o) => o.kind === 'won')
  const lost = closed.filter((o) => o.kind === 'lost')
  return {
    created: cohort?.n ?? 0,
    conversion: computeConversion(changes, stages).map((step) => ({ ...step, name: names.get(step.stageId)! })),
    won: won.length,
    lost: lost.length,
    winRate: winRate(won.length, lost.length),
    averageCycleDays: averageCycleDays(won.map((o) => ({ createdAt: o.createdAt, closedAt: o.closedAt! }))),
  }
}

export async function getOpportunityFor(me: AuthCtx, opportunityId: string) {
  const [row] = await db
    .select({
      opp: opportunities,
      leadName: leads.name,
      ownerName: users.name,
      teamName: teams.name,
      stageName: pipelineStages.name,
      stageKind: pipelineStages.kind,
    })
    .from(opportunities)
    .innerJoin(leads, eq(leads.id, opportunities.leadId))
    .innerJoin(teams, eq(teams.id, opportunities.teamId))
    .innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId))
    .leftJoin(users, eq(users.id, opportunities.ownerId))
    .where(and(eq(opportunities.id, opportunityId), eq(opportunities.tenantId, me.tenantId)))
  if (!row || !canSeeRecord(me, row.opp)) fail('Oportunidade não encontrada')

  const fromStage = alias(pipelineStages, 'from_stage')
  const toStage = alias(pipelineStages, 'to_stage')
  const [history, followUps, stages] = await Promise.all([
    db
      .select({ id: opportunityStageChanges.id, changedAt: opportunityStageChanges.changedAt, fromStageName: fromStage.name, toStageName: toStage.name, changedByName: users.name })
      .from(opportunityStageChanges)
      .innerJoin(toStage, eq(toStage.id, opportunityStageChanges.toStageId))
      .leftJoin(fromStage, eq(fromStage.id, opportunityStageChanges.fromStageId))
      .leftJoin(users, eq(users.id, opportunityStageChanges.changedById))
      .where(eq(opportunityStageChanges.opportunityId, opportunityId))
      .orderBy(asc(opportunityStageChanges.changedAt), asc(opportunityStageChanges.id)),
    db
      .select({ id: tasks.id, title: tasks.title, status: tasks.status, dueDate: tasks.dueDate, assigneeName: users.name })
      .from(tasks)
      .leftJoin(users, eq(users.id, tasks.assignedToId))
      .where(and(eq(tasks.opportunityId, opportunityId), eq(tasks.tenantId, me.tenantId)))
      .orderBy(asc(tasks.createdAt)),
    listStagesFor(me, row.opp.pipelineId),
  ])
  const canWrite = canWriteOpportunity(me, row.opp)
  return {
    opportunity: { ...row.opp, leadName: row.leadName, ownerName: row.ownerName, teamName: row.teamName, stageName: row.stageName, stageKind: row.stageKind },
    history,
    followUps,
    stages,
    canWrite,
    canReopen: canWrite && can(me, 'opportunity.reopen', row.opp.teamId),
  }
}
