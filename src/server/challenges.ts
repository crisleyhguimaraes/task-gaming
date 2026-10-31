import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '#/db'
import { challenges, tasks, teams, users } from '#/db/schema'
import { MAX_CHALLENGE_BASE_POINTS, MAX_SCORED_ATTEMPTS_PER_DAY } from '#/lib/challenge'
import { archiveChallengeFor, challengeRanking, createChallengeFor, listChallengesFor } from './challenges.core'
import { authMiddleware } from './auth-context'
import { canAccessTeam, canManage, fail } from './roles'
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
      basePoints: z.number().int().min(1).max(MAX_CHALLENGE_BASE_POINTS),
      estimatedMinutes: z.number().int().min(1).max(24 * 60),
      scoredAttemptsPerDay: z.number().int().min(1).max(MAX_SCORED_ATTEMPTS_PER_DAY),
      teamId: z.uuid(),
    }),
  )
  .handler(({ data, context: { auth: me } }) => createChallengeFor(me, data))

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
    if (!row || !canAccessTeam(me, row.challenge.teamId)) fail('Desafio não encontrado')
    const ranking = await challengeRanking(row.challenge.id)
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
  .handler(({ data, context: { auth: me } }) => archiveChallengeFor(me, data.challengeId))
