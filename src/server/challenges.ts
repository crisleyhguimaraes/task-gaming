import { createServerFn } from '@tanstack/react-start'
import { and, asc, count, desc, eq, min, sql, sum } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '#/db'
import { challenges, tasks, teams, users } from '#/db/schema'
import { validAttempt, listChallengesFor  } from './challenges.core'
import { authMiddleware } from './auth-context'
import { canManage, fail, isAdmin } from './roles'
import { attemptChallengeFor } from './tasks.core'

export const listChallenges = createServerFn()
  .middleware([authMiddleware])
  .handler(({ context }) => listChallengesFor(context.auth))

export const createChallenge = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(
    z.object({
      title: z.string().trim().min(2).max(200),
      description: z.string().trim().max(2000).optional(),
      basePoints: z.number().int().min(1).max(10000),
      estimatedMinutes: z.number().int().min(1).max(24 * 60),
      teamId: z.uuid(),
    }),
  )
  .handler(async ({ data, context: { auth: me } }) => {
    if (!isAdmin(me) && data.teamId !== me.teamId) fail('Você só cria desafios para a sua equipe')
    const [team] = await db.select({ id: teams.id }).from(teams).where(and(eq(teams.id, data.teamId), eq(teams.tenantId, me.tenantId)))
    if (!team) fail('Equipe não encontrada')
    const [c] = await db
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
    return c!
  })

export const getChallenge = createServerFn()
  .middleware([authMiddleware])
  .validator(z.object({ challengeId: z.uuid() }))
  .handler(async ({ data, context: { auth: me } }) => {
    const [row] = await db
      .select({ challenge: challenges, teamName: teams.name, creatorName: users.name })
      .from(challenges)
      .innerJoin(teams, eq(teams.id, challenges.teamId))
      .leftJoin(users, eq(users.id, challenges.createdById))
      .where(and(eq(challenges.id, data.challengeId), eq(challenges.tenantId, me.tenantId)))
    if (!row || (!isAdmin(me) && row.challenge.teamId !== me.teamId)) fail('Desafio não encontrado')
    const ranking = await db
      .select({
        userId: users.id,
        name: users.name,
        best: min(tasks.movingSeconds),
        attempts: count(),
        points: sum(tasks.awardedPoints).mapWith(Number),
      })
      .from(tasks)
      .innerJoin(users, eq(users.id, tasks.assignedToId))
      .where(and(eq(tasks.challengeId, row.challenge.id), validAttempt))
      .groupBy(users.id, users.name)
      .orderBy(asc(min(tasks.movingSeconds)))
    const [mine] = await db
      .select({ id: tasks.id, status: tasks.status })
      .from(tasks)
      .where(and(eq(tasks.challengeId, row.challenge.id), eq(tasks.assignedToId, me.userId), sql`${tasks.status} in ('pending','in_progress','paused')`))
      .orderBy(desc(tasks.createdAt))
      .limit(1)
    const canEdit = row.challenge.createdById === me.userId || canManage(me, row.challenge)
    return { ...row.challenge, teamName: row.teamName, creatorName: row.creatorName, ranking, openAttempt: mine ?? null, canEdit }
  })

export const attemptChallenge = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ challengeId: z.uuid() }))
  .handler(({ data, context }) => attemptChallengeFor(context.auth, data.challengeId))

export const archiveChallenge = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ challengeId: z.uuid() }))
  .handler(async ({ data, context: { auth: me } }) => {
    const [c] = await db.select().from(challenges).where(and(eq(challenges.id, data.challengeId), eq(challenges.tenantId, me.tenantId)))
    if (!c) fail('Desafio não encontrado')
    if (c.createdById !== me.userId && !canManage(me, c)) fail('Sem permissão')
    await db.update(challenges).set({ archivedAt: new Date() }).where(eq(challenges.id, c.id))
  })
