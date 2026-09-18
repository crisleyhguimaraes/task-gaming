import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '#/db'
import { challenges, tasks, teams, users } from '#/db/schema'
import type { AuthCtx } from './roles'
import { isAdmin } from './roles'

export const validAttempt = and(eq(tasks.status, 'finished'), eq(tasks.needsValidation, false))

/** Desafios visíveis + recorde atual (melhor tempo e quem). */
export async function listChallengesFor(me: AuthCtx, includeArchived = false) {
  const list = await db
    .select({ challenge: challenges, teamName: teams.name })
    .from(challenges)
    .innerJoin(teams, eq(teams.id, challenges.teamId))
    .where(
      and(
        eq(challenges.tenantId, me.tenantId),
        isAdmin(me) ? undefined : eq(challenges.teamId, me.teamId ?? ''),
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
    .orderBy(tasks.challengeId, asc(tasks.movingSeconds))
  const byId = new Map(records.map((r) => [r.challengeId, r]))
  return list.map(({ challenge, teamName }) => ({ ...challenge, teamName, record: byId.get(challenge.id) ?? null }))
}
