import { and, asc, count, desc, eq, getTableColumns, ilike, inArray, isNull, or } from 'drizzle-orm'
import { db } from '#/db'
import type { LeadStatus } from '#/db/schema'
import { leads, opportunities, pipelineStages, teams, users } from '#/db/schema'
import { diffFields } from '#/lib/audit'
import type { LeadSource, OwnerLoad, ParsedLead, RawLeadRow } from '#/lib/leads'
import { leadsPageSize, parseLeadRow, poolOwnerFilter, takeLeastLoaded } from '#/lib/leads'
import { recordAudit } from './audit.core'
import { listNotesFor } from './notes.core'
import type { AuthCtx } from './roles'
import { canManage, canSee, fail, forbid } from './roles'
import { activeMembersOf, assertMember, inTenantTeams, inTeams } from './scope'
import { assertTeamInTenant } from './teams.core'
import type { Reader } from './tx'

const maxDuplicateCandidates = 5
const maxPageSize = 100
const hiddenLeadName = 'Lead de outra equipe'

type Lead = typeof leads.$inferSelect

/** Lead se comporta como tarefa: o dono (`ownerId`) faz o papel de `assignedToId` nas regras de visibilidade. */
const visibility = (lead: Pick<Lead, 'teamId' | 'ownerId'>) => ({ teamId: lead.teamId, assignedToId: lead.ownerId })

const canEditLead = (me: AuthCtx, lead: Pick<Lead, 'teamId' | 'ownerId'>) => canManage(me, lead) || lead.ownerId === me.userId

async function loadLead(tx: Reader, me: AuthCtx, leadId: string) {
  const [lead] = await tx.select().from(leads).where(and(eq(leads.id, leadId), eq(leads.tenantId, me.tenantId)))
  if (!lead || !canSee(me, visibility(lead))) fail('Lead não encontrado')
  return lead
}

function parseOrFail(raw: RawLeadRow) {
  const parsed = parseLeadRow(raw)
  if (!parsed.ok) fail(Object.values(parsed.errors).join('; '))
  return parsed.lead
}

export type DuplicateCandidate = {
  id: string
  visible: boolean
  name: string
  company: string | null
  email: string | null
  phone: string | null
}

/** Duplicado vale no tenant inteiro; de lead que o usuário não enxerga só se revela que existe. */
async function findDuplicates(tx: Reader, me: AuthCtx, contact: Pick<ParsedLead, 'emailNormalized' | 'phoneDigits'>): Promise<Array<DuplicateCandidate>> {
  const sameContact = or(
    contact.emailNormalized ? eq(leads.emailNormalized, contact.emailNormalized) : undefined,
    contact.phoneDigits ? eq(leads.phoneDigits, contact.phoneDigits) : undefined,
  )
  if (!sameContact) return []
  const rows = await tx
    .select()
    .from(leads)
    .where(and(eq(leads.tenantId, me.tenantId), sameContact))
    .orderBy(asc(leads.createdAt))
    .limit(maxDuplicateCandidates)
  return rows.map((lead) =>
    canSee(me, visibility(lead))
      ? { id: lead.id, visible: true, name: lead.name, company: lead.company, email: lead.email, phone: lead.phone }
      : { id: lead.id, visible: false, name: hiddenLeadName, company: null, email: null, phone: null },
  )
}

export type NewLead = RawLeadRow & { teamId: string; ownerId?: string | null }
export type CreateLeadResult = { created: true; lead: Lead } | { created: false; duplicates: Array<DuplicateCandidate> }

export async function createLeadFor(me: AuthCtx, data: NewLead, { force = false }: { force?: boolean } = {}): Promise<CreateLeadResult> {
  const parsed = parseOrFail(data)
  const ownerId = data.ownerId ?? null
  if (!canSee(me, { teamId: data.teamId, assignedToId: ownerId })) forbid()
  if (ownerId && ownerId !== me.userId && !canManage(me, data)) forbid()
  return db.transaction(async (tx) => {
    await assertTeamInTenant(tx, me.tenantId, data.teamId)
    if (ownerId) await assertMember(tx, { tenantId: me.tenantId, userId: ownerId, teamId: data.teamId })
    if (!force) {
      const duplicates = await findDuplicates(tx, me, parsed)
      if (duplicates.length > 0) return { created: false, duplicates }
    }
    const [lead] = await tx.insert(leads).values({ ...parsed, tenantId: me.tenantId, teamId: data.teamId, ownerId, createdById: me.userId }).returning()
    await recordAudit(tx, me, {
      action: 'lead.created',
      entityType: 'lead',
      entityId: lead!.id,
      meta: { name: lead!.name, teamId: lead!.teamId, ownerId, source: lead!.source },
    })
    return { created: true, lead: lead! }
  })
}

export type LeadEdit = Omit<RawLeadRow, 'source'> & { source: LeadSource; status: LeadStatus }

const auditedLeadFields = ['name', 'company', 'email', 'phone', 'source', 'status'] as const

export async function updateLeadFor(me: AuthCtx, leadId: string, data: LeadEdit) {
  const parsed = parseOrFail(data)
  await db.transaction(async (tx) => {
    const lead = await loadLead(tx, me, leadId)
    if (!canEditLead(me, lead)) forbid()
    const [updated] = await tx.update(leads).set({ ...parsed, status: data.status }).where(eq(leads.id, lead.id)).returning()
    const changes = diffFields(lead, updated!, auditedLeadFields)
    if (Object.keys(changes).length > 0) await recordAudit(tx, me, { action: 'lead.updated', entityType: 'lead', entityId: lead.id, changes })
  })
}

export type LeadFilters = {
  status?: LeadStatus
  source?: LeadSource
  /** Id do dono, ou `poolOwnerFilter` para leads sem dono. */
  ownerId?: string
  teamId?: string
  search?: string
  limit?: number
  offset?: number
}

function ownerFilter(ownerId: string | undefined) {
  if (!ownerId) return undefined
  return ownerId === poolOwnerFilter ? isNull(leads.ownerId) : eq(leads.ownerId, ownerId)
}

function searchFilter(search: string | undefined) {
  const term = search?.trim()
  if (!term) return undefined
  return or(ilike(leads.name, `%${term}%`), ilike(leads.company, `%${term}%`), ilike(leads.email, `%${term}%`))
}

export async function listLeadsFor(me: AuthCtx, filters: LeadFilters) {
  const limit = Math.min(filters.limit ?? leadsPageSize, maxPageSize)
  const where = and(
    inTenantTeams(leads, me, { only: filters.teamId }),
    filters.status ? eq(leads.status, filters.status) : undefined,
    filters.source ? eq(leads.source, filters.source) : undefined,
    ownerFilter(filters.ownerId),
    searchFilter(filters.search),
  )
  const [rows, [totals]] = await Promise.all([
    db
      .select({ ...getTableColumns(leads), ownerName: users.name, teamName: teams.name })
      .from(leads)
      .leftJoin(users, eq(users.id, leads.ownerId))
      .innerJoin(teams, eq(teams.id, leads.teamId))
      .where(where)
      .orderBy(desc(leads.createdAt), desc(leads.id))
      .limit(limit)
      .offset(filters.offset ?? 0),
    db.select({ total: count() }).from(leads).where(where),
  ])
  return { leads: rows, total: totals?.total ?? 0 }
}

export async function getLeadFor(me: AuthCtx, leadId: string) {
  const [row] = await db
    .select({ lead: leads, ownerName: users.name, teamName: teams.name })
    .from(leads)
    .leftJoin(users, eq(users.id, leads.ownerId))
    .innerJoin(teams, eq(teams.id, leads.teamId))
    .where(and(eq(leads.id, leadId), eq(leads.tenantId, me.tenantId)))
  if (!row || !canSee(me, visibility(row.lead))) fail('Lead não encontrado')
  const [leadOpportunities, notes] = await Promise.all([
    db
      .select({
        id: opportunities.id,
        title: opportunities.title,
        amountCents: opportunities.amountCents,
        closedAt: opportunities.closedAt,
        stageName: pipelineStages.name,
        stageKind: pipelineStages.kind,
      })
      .from(opportunities)
      .innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId))
      .where(and(eq(opportunities.leadId, leadId), eq(opportunities.tenantId, me.tenantId)))
      .orderBy(desc(opportunities.createdAt)),
    listNotesFor(me, { type: 'lead', id: leadId }),
  ])
  return {
    lead: { ...row.lead, ownerName: row.ownerName, teamName: row.teamName },
    opportunities: leadOpportunities,
    notes,
    canEdit: canEditLead(me, row.lead),
    canManage: canManage(me, row.lead),
  }
}

export async function deleteLeadFor(me: AuthCtx, leadId: string) {
  await db.transaction(async (tx) => {
    const lead = await loadLead(tx, me, leadId)
    if (!canManage(me, lead)) forbid()
    const [linked] = await tx.select({ total: count() }).from(opportunities).where(eq(opportunities.leadId, lead.id))
    if (linked!.total > 0) fail('Lead tem oportunidades; não pode ser excluído')
    await tx.delete(leads).where(eq(leads.id, lead.id))
    await recordAudit(tx, me, { action: 'lead.deleted', entityType: 'lead', entityId: lead.id, meta: { name: lead.name } })
  })
}

/** Assume um lead sem dono da própria equipe. O UPDATE condicional é o lock: só uma chamada concorrente leva. */
export async function claimLeadFor(me: AuthCtx, leadId: string) {
  if (!me.teamId) fail('Você precisa estar em uma equipe')
  return db.transaction(async (tx) => {
    const [lead] = await tx
      .update(leads)
      .set({ ownerId: me.userId })
      .where(and(eq(leads.id, leadId), eq(leads.tenantId, me.tenantId), eq(leads.teamId, me.teamId!), isNull(leads.ownerId)))
      .returning()
    if (!lead) fail('Lead indisponível: já tem dono ou não é da sua equipe')
    await recordAudit(tx, me, { action: 'lead.claimed', entityType: 'lead', entityId: lead.id, changes: { ownerId: { from: null, to: me.userId } } })
    return lead
  })
}

export async function assignLeadFor(me: AuthCtx, leadId: string, ownerId: string) {
  await db.transaction(async (tx) => {
    const lead = await loadLead(tx, me, leadId)
    if (!canManage(me, lead)) forbid()
    await assertMember(tx, { tenantId: me.tenantId, userId: ownerId, teamId: lead.teamId })
    if (lead.ownerId === ownerId) return
    const [updated] = await tx.update(leads).set({ ownerId }).where(eq(leads.id, lead.id)).returning()
    await recordAudit(tx, me, { action: 'lead.assigned', entityType: 'lead', entityId: lead.id, changes: diffFields(lead, updated!, ['ownerId']) })
  })
}

export async function leadOptionsFor(me: AuthCtx) {
  const teamList = await db
    .select({ id: teams.id, name: teams.name })
    .from(teams)
    .where(and(eq(teams.tenantId, me.tenantId), inTeams(teams.id, me)))
    .orderBy(asc(teams.name))
  const members = await db
    .select({ id: users.id, name: users.name, teamId: users.teamId })
    .from(users)
    .where(activeMembersOf(me.tenantId, teamList.map((t) => t.id)))
    .orderBy(asc(users.name))
  return { teams: teamList, members }
}

export async function teamLoads(tx: Reader, tenantId: string, teamId: string): Promise<Array<OwnerLoad>> {
  const openStageIds = tx
    .select({ id: pipelineStages.id })
    .from(pipelineStages)
    .where(and(eq(pipelineStages.tenantId, tenantId), eq(pipelineStages.kind, 'open')))
  return tx
    .select({ id: users.id, name: users.name, open: count(opportunities.id) })
    .from(users)
    .leftJoin(opportunities, and(eq(opportunities.ownerId, users.id), inArray(opportunities.stageId, openStageIds)))
    .where(activeMembersOf(tenantId, [teamId]))
    .groupBy(users.id, users.name)
    .orderBy(asc(users.id))
}

export async function leastLoadedOwner(tx: Reader, tenantId: string, teamId: string) {
  return takeLeastLoaded(await teamLoads(tx, tenantId, teamId))?.id ?? null
}
