import { and, asc, desc, eq } from 'drizzle-orm'
import { db } from '#/db'
import { goals, teamMembers, teams, users } from '#/db/schema'
import { diffFields } from '#/lib/audit'
import type { GoalRule } from '#/lib/goals'
import { BUSINESS_DAYS, validateGoal } from '#/lib/goals'
import { recordAudit } from './audit.core'
import { DEFAULT_ITEM_NAME, goalLink, replaceTeamsOfItem, teamsAuditMeta, teamsByItem } from './catalog.core'
import { failOnDuplicate } from './duplicate'
import type { AuthCtx } from './roles'
import { fail, requireCan } from './roles'
import { insertDefaultScoringRule } from './scoring-rules.core'
import type { Reader, Tx } from './tx'
import { assertValidName } from './validation'

const DEFAULT_TARGET_POINTS = 100
const DUPLICATE_NAME = 'Já existe uma meta com esse nome'

export type GoalInput = { name: string; targetPoints: number; activeDays: ReadonlyArray<number> }

/** O que todo tenant precisa ter desde o nascimento: sem estes dois o resolvedor não tem para onde cair. */
export async function insertDefaultGoalAndRule(tx: Pick<typeof db, 'insert'>, tenantId: string) {
  const [goal] = await tx
    .insert(goals)
    .values({ tenantId, name: DEFAULT_ITEM_NAME, targetPoints: DEFAULT_TARGET_POINTS, activeDays: [...BUSINESS_DAYS], isDefault: true })
    .returning()
  return { goal: goal!, scoringRule: await insertDefaultScoringRule(tx, tenantId) }
}

/** Uma meta por vínculo de equipe da pessoa (equipe sem meta própria e pessoa sem equipe valem a padrão). Falha se faltar o padrão. */
export async function effectiveGoalsOf(tx: Reader, userId: string): Promise<Array<GoalRule>> {
  const links = await tx
    .select({ tenantId: users.tenantId, goalId: teams.goalId })
    .from(users)
    .leftJoin(teamMembers, eq(teamMembers.userId, users.id))
    .leftJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(eq(users.id, userId))
  if (!links.length) fail('Pessoa não encontrada')
  const catalog = await tx.select().from(goals).where(eq(goals.tenantId, links[0]!.tenantId))
  const standard = catalog.find((goal) => goal.isDefault)
  if (!standard) fail('O tenant não tem meta padrão')
  return links.map((link) => catalog.find((goal) => goal.id === link.goalId) ?? standard)
}

const goalEntity = (goalId: string) => ({ entityType: 'goal', entityId: goalId })

const sortedDays = (days: ReadonlyArray<number>) => [...days].sort((a, b) => a - b)

/** Os dias viram texto na auditoria: o diff só aceita escalares. */
const auditView = ({ name, targetPoints, activeDays }: GoalInput) => ({ name, targetPoints, activeDays: activeDays.join(',') })

function assertValidGoal(input: GoalInput) {
  assertValidName(input.name, 'da meta')
  const errors = validateGoal(input)
  if (errors.length) fail(errors.join('; '))
}

/** FOR UPDATE: duas operações no mesmo item se enfileiram, e a segunda enxerga o que a primeira gravou. */
async function loadGoal(tx: Tx, me: AuthCtx, goalId: string) {
  const [goal] = await tx.select().from(goals).where(and(eq(goals.id, goalId), eq(goals.tenantId, me.tenantId))).for('update')
  if (!goal) fail('Meta não encontrada')
  return goal
}

/** O padrão primeiro; cada meta com as equipes que a usam (no padrão, as sem meta própria). */
export async function listGoalsFor(me: AuthCtx) {
  requireCan(me, 'goal.configure')
  const items = await db.select().from(goals).where(eq(goals.tenantId, me.tenantId)).orderBy(desc(goals.isDefault), asc(goals.name))
  const teamsOf = await teamsByItem(db, me.tenantId, goalLink)
  return items.map((goal) => ({ ...goal, teams: teamsOf.get(goal.isDefault ? null : goal.id) ?? [] }))
}

export async function createGoalFor(me: AuthCtx, input: GoalInput) {
  requireCan(me, 'goal.configure')
  assertValidGoal(input)
  return db.transaction(async (tx) => {
    const [goal] = await failOnDuplicate(
      DUPLICATE_NAME,
      tx.insert(goals).values({ tenantId: me.tenantId, name: input.name.trim(), targetPoints: input.targetPoints, activeDays: sortedDays(input.activeDays) }).returning(),
    )
    await recordAudit(tx, me, { action: 'goal.created', ...goalEntity(goal!.id), meta: auditView(goal!) })
    return goal!
  })
}

/**
 * Mudar os dias reescreve a sequência de todos de uma vez: ela é derivada por consulta, sem histórico dos dias que valiam antes.
 * A auditoria guarda o antes e o depois.
 */
export async function updateGoalFor(me: AuthCtx, goalId: string, input: GoalInput) {
  requireCan(me, 'goal.configure')
  assertValidGoal(input)
  return db.transaction(async (tx) => {
    const goal = await loadGoal(tx, me, goalId)
    const [updated] = await failOnDuplicate(
      DUPLICATE_NAME,
      tx.update(goals).set({ name: input.name.trim(), targetPoints: input.targetPoints, activeDays: sortedDays(input.activeDays) }).where(eq(goals.id, goal.id)).returning(),
    )
    const changes = diffFields(auditView(goal), auditView(updated!), ['name', 'targetPoints', 'activeDays'])
    if (Object.keys(changes).length) await recordAudit(tx, me, { action: 'goal.updated', ...goalEntity(goal.id), changes })
    return updated!
  })
}

/** As equipes da meta excluída voltam ao padrão: a FK zera o vínculo. */
export async function deleteGoalFor(me: AuthCtx, goalId: string) {
  requireCan(me, 'goal.configure')
  await db.transaction(async (tx) => {
    const goal = await loadGoal(tx, me, goalId)
    if (goal.isDefault) fail('A meta padrão não pode ser excluída')
    const released = await tx.select({ id: teams.id }).from(teams).where(and(eq(teams.tenantId, me.tenantId), eq(teams.goalId, goal.id)))
    await tx.delete(goals).where(eq(goals.id, goal.id))
    await recordAudit(tx, me, {
      action: 'goal.deleted',
      ...goalEntity(goal.id),
      meta: teamsAuditMeta(goal.name, { added: [], removed: released.map((team) => team.id) }),
    })
  })
}

/** Define exatamente as equipes da meta. A equipe fora da lista volta ao padrão; a que estava em outra meta passa para esta. */
export async function setGoalTeamsFor(me: AuthCtx, goalId: string, teamIds: ReadonlyArray<string>) {
  requireCan(me, 'goal.configure')
  await db.transaction(async (tx) => {
    const goal = await loadGoal(tx, me, goalId)
    if (goal.isDefault) fail('A meta padrão vale para as equipes sem meta própria; vincule a equipe a outra meta')
    const diff = await replaceTeamsOfItem(tx, me.tenantId, goalLink, goal.id, teamIds)
    if (!diff.added.length && !diff.removed.length) return
    await recordAudit(tx, me, { action: 'goal.teams_changed', ...goalEntity(goal.id), meta: teamsAuditMeta(goal.name, diff) })
  })
}
