import { and, asc, count, eq, gt, inArray, isNull, notInArray, or, sql } from 'drizzle-orm'
import { db } from '#/db'
import { challengeTeams, challenges, tasks, teamMembers, teams, users } from '#/db/schema'
import type { ChallengeReach } from '#/lib/challenge'
import { MAX_CHALLENGE_BASE_POINTS, MAX_SCORED_ATTEMPTS_PER_DAY, canSeeChallenge, competingTeamIds, countAttempts, rankTeams } from '#/lib/challenge'
import { recordAudit } from './audit.core'
import { teamsAuditMeta } from './catalog.core'
import type { TeamsDiff } from './catalog.core'
import type { AuthCtx } from './roles'
import { canAccessTeam, canManage, canManageWith, fail, forbid, isAdmin, requireCan } from './roles'
import { inOpen } from './stats'
import { assertTeamInTenant } from './teams.core'
import type { Reader, Tx } from './tx'

/** Tentativa que vale para tempo e recorde: concluída, sem validação pendente e não rejeitada. */
export const validAttempt = and(eq(tasks.status, 'finished'), eq(tasks.needsValidation, false), isNull(tasks.rejectedAt))

/** Tentativa que gastou uma das vagas pontuadas do dia: concluída, não rejeitada e com pontos, mesmo que retidos para validação. */
export const scoringAttempt = and(eq(tasks.status, 'finished'), isNull(tasks.rejectedAt), gt(tasks.awardedPoints, 0))

/** Menor tempo vence; empate fica com quem concluiu primeiro e, no mesmo instante, com o menor id. */
export const bestFirst = [asc(tasks.movingSeconds), asc(tasks.finishedAt), asc(tasks.id)]

/**
 * Quem vê (e, com equipe no alcance, tenta) o desafio: o admin vê todos; os demais, os de equipes onde têm vínculo ou abertos ao tenant.
 * Espelha `canSeeChallenge` (lib/challenge.ts): mexa nos dois juntos. Sempre combine com o filtro de tenant.
 */
export function challengeAccess(me: AuthCtx) {
  if (isAdmin(me)) return undefined
  const teamIds = me.memberships.map((m) => m.teamId)
  if (teamIds.length === 0) return sql`false`
  return or(
    inArray(challenges.teamId, teamIds),
    eq(challenges.tenantWide, true),
    inArray(challenges.id, db.select({ id: challengeTeams.challengeId }).from(challengeTeams).where(inArray(challengeTeams.teamId, teamIds))),
  )
}

/** O desafio, se `me` o enxerga; do contrário, ele não existe. */
export async function accessibleChallenge(reader: Reader, me: AuthCtx, challengeId: string) {
  const [challenge] = await reader
    .select()
    .from(challenges)
    .where(and(eq(challenges.id, challengeId), eq(challenges.tenantId, me.tenantId), challengeAccess(me)))
  if (!challenge) fail('Desafio não encontrado')
  return challenge
}

export async function reachOf(reader: Reader, challenge: { id: string; teamId: string; tenantWide: boolean }): Promise<ChallengeReach> {
  const shared = await reader.select({ teamId: challengeTeams.teamId }).from(challengeTeams).where(eq(challengeTeams.challengeId, challenge.id))
  return { teamId: challenge.teamId, tenantWide: challenge.tenantWide, sharedTeamIds: shared.map((s) => s.teamId) }
}

/**
 * Trava o desafio (FOR SHARE) e devolve as equipes de `me` que podem competir nele.
 * Compartilhar pede FOR UPDATE: espera as tentativas em curso, e as seguintes já leem o alcance novo.
 */
export async function lockChallengeForAttempt(tx: Tx, me: AuthCtx, challengeId: string) {
  const [challenge] = await tx
    .select()
    .from(challenges)
    .where(and(eq(challenges.id, challengeId), eq(challenges.tenantId, me.tenantId), isNull(challenges.archivedAt)))
    .for('share')
  if (!challenge) fail('Desafio não encontrado')
  const reach = await reachOf(tx, challenge)
  if (!canSeeChallenge(me, reach)) fail('Desafio não encontrado')
  return { challenge, candidateTeamIds: competingTeamIds(me, reach) }
}

/** Desafios visíveis + recorde atual (melhor tempo e quem). */
export async function listChallengesFor(me: AuthCtx, includeArchived = false) {
  const list = await db
    .select({ challenge: challenges, teamName: teams.name })
    .from(challenges)
    .innerJoin(teams, eq(teams.id, challenges.teamId))
    .where(and(eq(challenges.tenantId, me.tenantId), challengeAccess(me), includeArchived ? undefined : isNull(challenges.archivedAt)))
    .orderBy(asc(challenges.title))
  if (list.length === 0) return []
  // Recorde por desafio: primeira linha por challenge_id ordenada pelo menor tempo.
  const records = await db
    .selectDistinctOn([tasks.challengeId], { challengeId: tasks.challengeId, best: tasks.movingSeconds, holder: users.name, holderId: users.id })
    .from(tasks)
    .innerJoin(users, eq(users.id, tasks.assignedToId))
    .where(and(eq(tasks.tenantId, me.tenantId), validAttempt, sql`${tasks.challengeId} is not null`))
    .orderBy(tasks.challengeId, ...bestFirst)
  const byId = new Map(records.map((r) => [r.challengeId, r]))
  return list.map(({ challenge, teamName }) => ({ ...challenge, teamName, record: byId.get(challenge.id) ?? null }))
}

/** Melhor tentativa válida de cada pessoa, da mais rápida para a mais lenta, com a equipe pela qual ela foi feita. */
export function challengeRanking(challengeId: string) {
  const bestPerUser = db
    .selectDistinctOn([tasks.assignedToId], {
      userId: users.id,
      name: users.name,
      teamId: tasks.teamId,
      teamName: sql<string>`${teams.name}`.as('team_name'),
      best: tasks.movingSeconds,
      finishedAt: tasks.finishedAt,
      taskId: sql<string>`${tasks.id}`.as('task_id'),
      attempts: sql<number>`(count(*) over (partition by ${tasks.assignedToId}))::int`.as('attempts'),
      points: sql<number>`(coalesce(sum(${tasks.awardedPoints}) over (partition by ${tasks.assignedToId}), 0))::int`.as('points'),
    })
    .from(tasks)
    .innerJoin(users, eq(users.id, tasks.assignedToId))
    .innerJoin(teams, eq(teams.id, tasks.teamId))
    .where(and(eq(tasks.challengeId, challengeId), validAttempt))
    .orderBy(tasks.assignedToId, ...bestFirst)
    .as('best_per_user')
  return db
    .select({
      userId: bestPerUser.userId,
      name: bestPerUser.name,
      teamId: bestPerUser.teamId,
      teamName: bestPerUser.teamName,
      best: bestPerUser.best,
      attempts: bestPerUser.attempts,
      points: bestPerUser.points,
    })
    .from(bestPerUser)
    .orderBy(asc(bestPerUser.best), asc(bestPerUser.finishedAt), asc(bestPerUser.taskId))
}

/** Uma pessoa que tentou por duas equipes entra nas duas, cada uma com o melhor tempo feito por ela. */
export async function challengeTeamRanking(challengeId: string) {
  const bests = await db
    .selectDistinctOn([tasks.teamId, tasks.assignedToId], {
      teamId: tasks.teamId,
      teamName: teams.name,
      userId: sql<string>`${tasks.assignedToId}`,
      seconds: sql<number>`${tasks.movingSeconds}`,
      finishedAt: sql<Date>`${tasks.finishedAt}`.mapWith(tasks.finishedAt),
    })
    .from(tasks)
    .innerJoin(teams, eq(teams.id, tasks.teamId))
    .where(and(eq(tasks.challengeId, challengeId), validAttempt))
    .orderBy(tasks.teamId, tasks.assignedToId, ...bestFirst)
  const teamIds = [...new Set(bests.map((b) => b.teamId))]
  const members = teamIds.length ? await db.select({ teamId: teamMembers.teamId, userId: teamMembers.userId }).from(teamMembers).where(inArray(teamMembers.teamId, teamIds)) : []
  const memberIdsByTeam = new Map<string, Set<string>>()
  for (const { teamId, userId } of members) memberIdsByTeam.set(teamId, (memberIdsByTeam.get(teamId) ?? new Set()).add(userId))
  return rankTeams(bests, memberIdsByTeam)
}

/** A equipe dona do desafio, ou null se a tarefa não é tentativa (ou o desafio não é do tenant). */
export async function ownerTeamOf(reader: Reader, tenantId: string, challengeId: string | null) {
  if (!challengeId) return null
  const [challenge] = await reader.select({ teamId: challenges.teamId }).from(challenges).where(and(eq(challenges.id, challengeId), eq(challenges.tenantId, tenantId)))
  return challenge?.teamId ?? null
}

const idsOf = (rows: ReadonlyArray<{ id: string }>) => rows.map((r) => r.id)

export async function challengeDetailFor(me: AuthCtx, challengeId: string) {
  const [row] = await db
    .select({ challenge: challenges, teamName: teams.name, creatorName: users.name })
    .from(challenges)
    .innerJoin(teams, eq(teams.id, challenges.teamId))
    .leftJoin(users, eq(users.id, challenges.createdById))
    .where(and(eq(challenges.id, challengeId), eq(challenges.tenantId, me.tenantId), challengeAccess(me)))
  if (!row) fail('Desafio não encontrado')
  const { challenge } = row
  const sharedTeams = await db
    .select({ id: teams.id, name: teams.name })
    .from(challengeTeams)
    .innerJoin(teams, eq(teams.id, challengeTeams.teamId))
    .where(eq(challengeTeams.challengeId, challenge.id))
    .orderBy(asc(teams.name))
  const competingIds = competingTeamIds(me, { teamId: challenge.teamId, tenantWide: challenge.tenantWide, sharedTeamIds: idsOf(sharedTeams) })
  const competingTeams = competingIds.length ? await db.select({ id: teams.id, name: teams.name }).from(teams).where(inArray(teams.id, competingIds)).orderBy(asc(teams.name)) : []
  const [openAttempt] = await db
    .select({ id: tasks.id, status: tasks.status })
    .from(tasks)
    .where(and(eq(tasks.challengeId, challenge.id), eq(tasks.assignedToId, me.userId), inOpen()))
    .limit(1)
  return {
    ...challenge,
    teamName: row.teamName,
    creatorName: row.creatorName,
    sharedTeams,
    competingTeams,
    ranking: await challengeRanking(challenge.id),
    teamRanking: await challengeTeamRanking(challenge.id),
    openAttempt: openAttempt ?? null,
    canEdit: challenge.createdById === me.userId || canManage(me, challenge),
    canShare: canManageWith(me, 'challenge.share', challenge.teamId),
  }
}

function assertWithinChallengeLimits({ basePoints, scoredAttemptsPerDay }: { basePoints: number; scoredAttemptsPerDay: number }) {
  if (basePoints > MAX_CHALLENGE_BASE_POINTS) fail(`Pontos base: no máximo ${MAX_CHALLENGE_BASE_POINTS}`)
  if (!Number.isInteger(scoredAttemptsPerDay) || scoredAttemptsPerDay < 1 || scoredAttemptsPerDay > MAX_SCORED_ATTEMPTS_PER_DAY) {
    fail(`Tentativas pontuadas por dia: um número inteiro de 1 a ${MAX_SCORED_ATTEMPTS_PER_DAY}`)
  }
}

/** A dona é implícita: fora da lista, e sem repetidas. */
const sharedIdsOf = (ownerTeamId: string, teamIds: ReadonlyArray<string>) => [...new Set(teamIds)].filter((id) => id !== ownerTeamId)

/**
 * Compartilhar é unilateral: o líder da dona só mexe com equipes que ele mesmo gerencia; o tenant todo e as demais equipes são do admin.
 * Vale para quem entra e para quem sai, porque tirar a equipe de outro líder também é decidir por ela.
 */
function assertCanShare(me: AuthCtx, ownerTeamId: string, changedTeamIds: ReadonlyArray<string>, tenantWideChanged: boolean) {
  if (!canManageWith(me, 'challenge.share', ownerTeamId)) forbid()
  if (isAdmin(me)) return
  if (tenantWideChanged || !changedTeamIds.every((teamId) => canManageWith(me, 'challenge.share', teamId))) forbid()
}

export type NewChallenge = {
  title: string
  description?: string
  basePoints: number
  estimatedMinutes: number
  scoredAttemptsPerDay: number
  teamId: string
  teamIds?: ReadonlyArray<string>
  tenantWide?: boolean
}

export async function createChallengeFor(me: AuthCtx, data: NewChallenge) {
  if (!canAccessTeam(me, data.teamId)) fail('Você só cria desafios para a sua equipe')
  requireCan(me, 'challenge.write', data.teamId)
  assertWithinChallengeLimits(data)
  const sharedIds = sharedIdsOf(data.teamId, data.teamIds ?? [])
  const tenantWide = data.tenantWide ?? false
  if (sharedIds.length || tenantWide) assertCanShare(me, data.teamId, sharedIds, tenantWide)
  return db.transaction(async (tx) => {
    for (const teamId of [data.teamId, ...sharedIds]) await assertTeamInTenant(tx, me.tenantId, teamId)
    const [challenge] = await tx
      .insert(challenges)
      .values({
        tenantId: me.tenantId,
        teamId: data.teamId,
        createdById: me.userId,
        title: data.title,
        description: data.description || null,
        basePoints: data.basePoints,
        estimatedSeconds: data.estimatedMinutes * 60,
        scoredAttemptsPerDay: data.scoredAttemptsPerDay,
        tenantWide,
      })
      .returning()
    if (sharedIds.length) await tx.insert(challengeTeams).values(sharedIds.map((teamId) => ({ challengeId: challenge!.id, teamId, tenantId: me.tenantId })))
    await recordAudit(tx, me, {
      action: 'challenge.created',
      entityType: 'challenge',
      entityId: challenge!.id,
      meta: {
        title: challenge!.title,
        teamId: challenge!.teamId,
        scoredAttemptsPerDay: challenge!.scoredAttemptsPerDay,
        tenantWide,
        sharedTeamIds: [...sharedIds].sort().join(','),
      },
    })
    return challenge!
  })
}

/** Equipe que ficaria fora do alcance com tentativa em aberto: a tentativa ficaria viva numa equipe que não compete mais. */
async function assertNoOpenAttemptsOutsideReach(tx: Tx, challenge: { id: string; teamId: string }, sharedIds: ReadonlyArray<string>, tenantWide: boolean) {
  if (tenantWide) return
  const [outside] = await tx
    .select({ n: count() })
    .from(tasks)
    .where(and(eq(tasks.challengeId, challenge.id), inOpen(), notInArray(tasks.teamId, [challenge.teamId, ...sharedIds])))
  if (outside!.n > 0) fail(`Há ${countAttempts(outside!.n)} em aberto de equipes que sairiam do desafio; conclua ou cancele antes de remover`)
}

/** Troca as equipes vinculadas e o `tenantWide` de uma vez. Devolve quem entrou e quem saiu; sem mudança, nada é gravado nem auditado. */
export async function setChallengeTeamsFor(me: AuthCtx, challengeId: string, sharing: { teamIds: ReadonlyArray<string>; tenantWide: boolean }): Promise<TeamsDiff> {
  return db.transaction(async (tx) => {
    // FOR UPDATE: espera as tentativas em curso (que seguram FOR SHARE) e faz as próximas lerem o alcance novo.
    const [challenge] = await tx
      .select()
      .from(challenges)
      .where(and(eq(challenges.id, challengeId), eq(challenges.tenantId, me.tenantId)))
      .for('update')
    if (!challenge) fail('Desafio não encontrado')
    if (!canManageWith(me, 'challenge.share', challenge.teamId)) forbid()
    const before = (await reachOf(tx, challenge)).sharedTeamIds
    const wanted = sharedIdsOf(challenge.teamId, sharing.teamIds)
    const diff: TeamsDiff = { added: wanted.filter((id) => !before.includes(id)).sort(), removed: before.filter((id) => !wanted.includes(id)).sort() }
    const tenantWideChanged = sharing.tenantWide !== challenge.tenantWide
    if (!diff.added.length && !diff.removed.length && !tenantWideChanged) return diff
    assertCanShare(me, challenge.teamId, [...diff.added, ...diff.removed], tenantWideChanged)
    for (const teamId of diff.added) await assertTeamInTenant(tx, me.tenantId, teamId)
    if (diff.removed.length) await tx.delete(challengeTeams).where(and(eq(challengeTeams.challengeId, challenge.id), inArray(challengeTeams.teamId, diff.removed)))
    if (diff.added.length) await tx.insert(challengeTeams).values(diff.added.map((teamId) => ({ challengeId: challenge.id, teamId, tenantId: me.tenantId })))
    if (tenantWideChanged) await tx.update(challenges).set({ tenantWide: sharing.tenantWide }).where(eq(challenges.id, challenge.id))
    await assertNoOpenAttemptsOutsideReach(tx, challenge, wanted, sharing.tenantWide)
    await recordAudit(tx, me, {
      action: 'challenge.teams_changed',
      entityType: 'challenge',
      entityId: challenge.id,
      changes: tenantWideChanged ? { tenantWide: { from: challenge.tenantWide, to: sharing.tenantWide } } : undefined,
      meta: teamsAuditMeta(challenge.title, diff),
    })
    return diff
  })
}

export async function archiveChallengeFor(me: AuthCtx, challengeId: string) {
  await db.transaction(async (tx) => {
    const [c] = await tx.select().from(challenges).where(and(eq(challenges.id, challengeId), eq(challenges.tenantId, me.tenantId)))
    if (!c) fail('Desafio não encontrado')
    if (c.createdById !== me.userId && !canManage(me, c)) forbid()
    await tx.update(challenges).set({ archivedAt: new Date() }).where(eq(challenges.id, c.id))
    await recordAudit(tx, me, { action: 'challenge.archived', entityType: 'challenge', entityId: c.id, meta: { title: c.title } })
  })
}
