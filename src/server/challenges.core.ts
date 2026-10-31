import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '#/db'
import { challenges, tasks, teams, users } from '#/db/schema'
import { recordAudit } from './audit.core'
import type { AuthCtx } from './roles'
import { canManage, fail, forbid, isAdmin } from './roles'
import { inTeams } from './scope'

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
    .orderBy(tasks.challengeId, asc(tasks.movingSeconds))
  const byId = new Map(records.map((r) => [r.challengeId, r]))
  return list.map(({ challenge, teamName }) => ({ ...challenge, teamName, record: byId.get(challenge.id) ?? null }))
}

export async function createChallengeFor(me: AuthCtx, data: { title: string; description?: string; basePoints: number; estimatedMinutes: number; teamId: string }) {
  if (!isAdmin(me) && data.teamId !== me.teamId) fail('Você só cria desafios para a sua equipe')
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
      })
      .returning()
    await recordAudit(tx, me, {
      action: 'challenge.created',
      entityType: 'challenge',
      entityId: challenge!.id,
      meta: { title: challenge!.title, teamId: challenge!.teamId },
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
