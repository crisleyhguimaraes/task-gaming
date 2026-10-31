import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm'
import { db } from '#/db'
import { challenges, tasks, teams, users } from '#/db/schema'
import { MAX_CHALLENGE_BASE_POINTS, MAX_SCORED_ATTEMPTS_PER_DAY } from '#/lib/challenge'
import { recordAudit } from './audit.core'
import type { AuthCtx } from './roles'
import { canManage, fail, forbid, isAdmin } from './roles'
import { inTeams } from './scope'

/** Tentativa que vale para tempo e recorde: concluída, sem validação pendente e não rejeitada. */
export const validAttempt = and(eq(tasks.status, 'finished'), eq(tasks.needsValidation, false), isNull(tasks.rejectedAt))

/** Tentativa que gastou uma das vagas pontuadas do dia: concluída, não rejeitada e com pontos, mesmo que retidos para validação. */
export const scoringAttempt = and(eq(tasks.status, 'finished'), isNull(tasks.rejectedAt), gt(tasks.awardedPoints, 0))

/** Menor tempo vence; empate fica com quem concluiu primeiro e, no mesmo instante, com o menor id. */
const bestFirst = [asc(tasks.movingSeconds), asc(tasks.finishedAt), asc(tasks.id)]

/** Desafios visíveis + recorde atual (melhor tempo e quem). */
export async function listChallengesFor(me: AuthCtx, includeArchived = false) {
  const list = await db
    .select({ challenge: challenges, teamName: teams.name })
    .from(challenges)
    .innerJoin(teams, eq(teams.id, challenges.teamId))
    .where(
      and(
        eq(challenges.tenantId, me.tenantId),
        inTeams(challenges.teamId, me),
        includeArchived ? undefined : isNull(challenges.archivedAt),
      ),
    )
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

/** Melhor tentativa válida de cada pessoa, da mais rápida para a mais lenta. */
export function challengeRanking(challengeId: string) {
  const bestPerUser = db
    .selectDistinctOn([tasks.assignedToId], {
      userId: users.id,
      name: users.name,
      best: tasks.movingSeconds,
      finishedAt: tasks.finishedAt,
      taskId: sql<string>`${tasks.id}`.as('task_id'),
      attempts: sql<number>`(count(*) over (partition by ${tasks.assignedToId}))::int`.as('attempts'),
      points: sql<number>`(coalesce(sum(${tasks.awardedPoints}) over (partition by ${tasks.assignedToId}), 0))::int`.as('points'),
    })
    .from(tasks)
    .innerJoin(users, eq(users.id, tasks.assignedToId))
    .where(and(eq(tasks.challengeId, challengeId), validAttempt))
    .orderBy(tasks.assignedToId, ...bestFirst)
    .as('best_per_user')
  return db
    .select({ userId: bestPerUser.userId, name: bestPerUser.name, best: bestPerUser.best, attempts: bestPerUser.attempts, points: bestPerUser.points })
    .from(bestPerUser)
    .orderBy(asc(bestPerUser.best), asc(bestPerUser.finishedAt), asc(bestPerUser.taskId))
}

function assertWithinChallengeLimits({ basePoints, scoredAttemptsPerDay }: { basePoints: number; scoredAttemptsPerDay: number }) {
  if (basePoints > MAX_CHALLENGE_BASE_POINTS) fail(`Pontos base: no máximo ${MAX_CHALLENGE_BASE_POINTS}`)
  if (!Number.isInteger(scoredAttemptsPerDay) || scoredAttemptsPerDay < 1 || scoredAttemptsPerDay > MAX_SCORED_ATTEMPTS_PER_DAY) {
    fail(`Tentativas pontuadas por dia: um número inteiro de 1 a ${MAX_SCORED_ATTEMPTS_PER_DAY}`)
  }
}

export async function createChallengeFor(
  me: AuthCtx,
  data: { title: string; description?: string; basePoints: number; estimatedMinutes: number; scoredAttemptsPerDay: number; teamId: string },
) {
  if (!isAdmin(me) && data.teamId !== me.teamId) fail('Você só cria desafios para a sua equipe')
  assertWithinChallengeLimits(data)
  return db.transaction(async (tx) => {
    const [team] = await tx.select({ id: teams.id }).from(teams).where(and(eq(teams.id, data.teamId), eq(teams.tenantId, me.tenantId)))
    if (!team) fail('Equipe não encontrada')
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
      })
      .returning()
    await recordAudit(tx, me, {
      action: 'challenge.created',
      entityType: 'challenge',
      entityId: challenge!.id,
      meta: { title: challenge!.title, teamId: challenge!.teamId, scoredAttemptsPerDay: challenge!.scoredAttemptsPerDay },
    })
    return challenge!
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
