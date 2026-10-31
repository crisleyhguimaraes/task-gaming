import { and, asc, count, eq, isNull } from 'drizzle-orm'
import { db } from '#/db'
import { boardTeams, boards, challenges, goals, leads, pipelines, scoringRules, tasks, teamMembers, teamPipelines, teams, users } from '#/db/schema'
import { canManageBoard } from '#/lib/boards'
import { diffFields } from '#/lib/audit'
import { recordAudit } from './audit.core'
import { failOnDuplicate } from './duplicate'
import type { AuthCtx } from './roles'
import { can, canAccessTeam, fail, requireCan } from './roles'
import type { Reader } from './tx'

const MIN_NAME_LENGTH = 2
const MAX_NAME_LENGTH = 100
const MAX_DESCRIPTION_LENGTH = 300
const DUPLICATE_NAME = 'Já existe uma equipe com esse nome'

export async function assertTeamInTenant(tx: Reader, tenantId: string, teamId: string | null) {
  if (!teamId) return
  const [t] = await tx.select({ id: teams.id }).from(teams).where(and(eq(teams.id, teamId), eq(teams.tenantId, tenantId)))
  if (!t) fail('Equipe não encontrada')
}

export async function createTeamFor(me: AuthCtx, name: string) {
  requireCan(me, 'team.manage')
  return db.transaction(async (tx) => {
    const [team] = await failOnDuplicate(DUPLICATE_NAME, tx.insert(teams).values({ tenantId: me.tenantId, name: name.trim() }).returning())
    await recordAudit(tx, me, { action: 'team.created', entityType: 'team', entityId: team!.id, meta: { name: team!.name } })
    return team!
  })
}

type TeamFields = { name: string; description: string }

function assertValidFields({ name, description }: TeamFields) {
  const length = name.trim().length
  if (length < MIN_NAME_LENGTH || length > MAX_NAME_LENGTH) fail(`O nome da equipe precisa ter de ${MIN_NAME_LENGTH} a ${MAX_NAME_LENGTH} caracteres`)
  if (description.trim().length > MAX_DESCRIPTION_LENGTH) fail(`A descrição pode ter até ${MAX_DESCRIPTION_LENGTH} caracteres`)
}

/** Sempre filtra por tenant: o id vem do cliente. */
async function loadTeam(tx: Reader, me: AuthCtx, teamId: string, lock?: 'update') {
  const query = tx.select().from(teams).where(and(eq(teams.id, teamId), eq(teams.tenantId, me.tenantId)))
  const [team] = await (lock ? query.for(lock) : query)
  if (!team) fail('Equipe não encontrada')
  return team
}

/** Descrição em branco limpa o campo. Dois renomes para o mesmo nome: o índice único decide e quem perde recebe a mensagem. */
export async function updateTeamFor(me: AuthCtx, teamId: string, fields: TeamFields) {
  requireCan(me, 'team.manage')
  assertValidFields(fields)
  return db.transaction(async (tx) => {
    const team = await loadTeam(tx, me, teamId, 'update')
    const [updated] = await failOnDuplicate(
      DUPLICATE_NAME,
      tx.update(teams).set({ name: fields.name.trim(), description: fields.description.trim() || null }).where(eq(teams.id, team.id)).returning(),
    )
    const changes = diffFields(team, updated!, ['name', 'description'])
    if (Object.keys(changes).length) await recordAudit(tx, me, { action: 'team.updated', entityType: 'team', entityId: team.id, changes })
    return updated!
  })
}

export async function deleteTeamFor(me: AuthCtx, teamId: string) {
  requireCan(me, 'team.manage')
  await db.transaction(async (tx) => {
    const team = await loadTeam(tx, me, teamId)
    for (const table of [teamMembers, tasks, challenges, leads]) {
      const [owned] = await tx.select({ n: count() }).from(table).where(and(eq(table.teamId, teamId), eq(table.tenantId, me.tenantId)))
      if (owned!.n > 0) fail('Equipe tem membros, tarefas, desafios ou leads; não pode ser excluída')
    }
    const unlinkedPipelines = await tx.delete(teamPipelines).where(eq(teamPipelines.teamId, teamId)).returning({ id: teamPipelines.pipelineId })
    const unlinkedBoards = await tx.delete(boardTeams).where(eq(boardTeams.teamId, teamId)).returning({ id: boardTeams.boardId })
    await tx.delete(teams).where(eq(teams.id, teamId))
    await recordAudit(tx, me, {
      action: 'team.deleted',
      entityType: 'team',
      entityId: teamId,
      meta: { name: team.name, unlinkedPipelines: unlinkedPipelines.length, unlinkedBoards: unlinkedBoards.length },
    })
  })
}

export function listTeamsFor(me: AuthCtx) {
  return db
    .select({ id: teams.id, name: teams.name, description: teams.description, members: count(teamMembers.userId) })
    .from(teams)
    .leftJoin(teamMembers, eq(teamMembers.teamId, teams.id))
    .where(eq(teams.tenantId, me.tenantId))
    .groupBy(teams.id)
    .orderBy(asc(teams.name))
}

const linkedPipelinesOf = (teamId: string) =>
  db
    .select({ id: pipelines.id, name: pipelines.name, archivedAt: pipelines.archivedAt })
    .from(teamPipelines)
    .innerJoin(pipelines, eq(pipelines.id, teamPipelines.pipelineId))
    .where(eq(teamPipelines.teamId, teamId))
    .orderBy(asc(pipelines.name))

const linkedBoardsOf = (teamId: string) =>
  db
    .select({ id: boards.id, name: boards.name, archivedAt: boards.archivedAt })
    .from(boardTeams)
    .innerJoin(boards, eq(boards.id, boardTeams.boardId))
    .where(eq(boardTeams.teamId, teamId))
    .orderBy(asc(boards.name))

const withArchivedFlag = <T extends { archivedAt: Date | null }>({ archivedAt, ...rest }: T) => ({ ...rest, archived: archivedAt !== null })

const notIn = (linked: ReadonlyArray<{ id: string }>) => (item: { id: string }) => !linked.some((l) => l.id === item.id)

const activePipelinesOf = (tenantId: string) =>
  db.select({ id: pipelines.id, name: pipelines.name }).from(pipelines).where(and(eq(pipelines.tenantId, tenantId), isNull(pipelines.archivedAt))).orderBy(asc(pipelines.name))

/** Boards ativos que `me` pode vincular a uma equipe: o servidor só aceita quem já gerencia o board (`canManageBoard`). */
async function linkableBoardsOf(me: AuthCtx) {
  const active = await db
    .select({ id: boards.id, name: boards.name })
    .from(boards)
    .where(and(eq(boards.tenantId, me.tenantId), isNull(boards.archivedAt)))
    .orderBy(asc(boards.name))
  const links = await db.select({ boardId: boardTeams.boardId, teamId: boardTeams.teamId }).from(boardTeams).where(eq(boardTeams.tenantId, me.tenantId))
  const teamsOf = (boardId: string) => links.filter((l) => l.boardId === boardId).map((l) => l.teamId)
  return active.filter((board) => canManageBoard(me, teamsOf(board.id)))
}

/** A meta e a pontuação que valem para a equipe: a vinculada ou, sem vínculo, a padrão do tenant. Falha se faltar o padrão. */
async function goalInUse(tenantId: string, goalId: string | null) {
  const [goal] = await db
    .select({ id: goals.id, name: goals.name, targetPoints: goals.targetPoints, activeDays: goals.activeDays, isDefault: goals.isDefault })
    .from(goals)
    .where(and(eq(goals.tenantId, tenantId), goalId ? eq(goals.id, goalId) : eq(goals.isDefault, true)))
  if (!goal) fail('O tenant não tem meta padrão')
  return goal
}

async function scoringRuleInUse(tenantId: string, scoringRuleId: string | null) {
  const [rule] = await db
    .select({ id: scoringRules.id, name: scoringRules.name, isDefault: scoringRules.isDefault })
    .from(scoringRules)
    .where(and(eq(scoringRules.tenantId, tenantId), scoringRuleId ? eq(scoringRules.id, scoringRuleId) : eq(scoringRules.isDefault, true)))
  if (!rule) fail('O tenant não tem pontuação padrão')
  return rule
}

/** Visível ao admin e a quem integra a equipe; as opções de vínculo só vêm para quem tem `team.link` nela. */
export async function teamDetailFor(me: AuthCtx, teamId: string) {
  const team = await loadTeam(db, me, teamId)
  if (!canAccessTeam(me, team.id)) fail('Equipe não encontrada')
  const canLink = can(me, 'team.link', team.id)
  const [members, pipelineLinks, boardLinks, [defaultPipeline], pipelineOptions, boardOptions, goal, scoringRule] = await Promise.all([
    db
      .select({ userId: users.id, name: users.name, role: teamMembers.role, banned: users.banned })
      .from(teamMembers)
      .innerJoin(users, eq(users.id, teamMembers.userId))
      .where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.tenantId, me.tenantId)))
      .orderBy(asc(teamMembers.role), asc(users.name)),
    linkedPipelinesOf(team.id),
    linkedBoardsOf(team.id),
    db.select({ id: pipelines.id, name: pipelines.name }).from(pipelines).where(and(eq(pipelines.tenantId, me.tenantId), eq(pipelines.isDefault, true))),
    canLink ? activePipelinesOf(me.tenantId) : [],
    canLink ? linkableBoardsOf(me) : [],
    goalInUse(me.tenantId, team.goalId),
    scoringRuleInUse(me.tenantId, team.scoringRuleId),
  ])
  return {
    team: { id: team.id, name: team.name, description: team.description },
    members,
    pipelines: pipelineLinks.map(withArchivedFlag),
    boards: boardLinks.map(withArchivedFlag),
    defaultPipeline: defaultPipeline ?? null,
    availablePipelines: pipelineOptions.filter(notIn(pipelineLinks)),
    availableBoards: boardOptions.filter(notIn(boardLinks)),
    goal,
    scoringRule,
  }
}
