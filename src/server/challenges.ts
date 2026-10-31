import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { MAX_CHALLENGE_BASE_POINTS, MAX_SCORED_ATTEMPTS_PER_DAY } from '#/lib/challenge'
import { archiveChallengeFor, challengeDetailFor, createChallengeFor, listChallengesFor, setChallengeTeamsFor } from './challenges.core'
import { authMiddleware } from './auth-context'
import { attemptChallengeFor } from './tasks.core'

const byId = z.object({ challengeId: z.uuid() })

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
      teamIds: z.array(z.uuid()).optional(),
      tenantWide: z.boolean().optional(),
    }),
  )
  .handler(({ data, context: { auth: me } }) => createChallengeFor(me, data))

export const getChallenge = createServerFn()
  .middleware([authMiddleware])
  .validator(byId)
  .handler(({ data, context: { auth: me } }) => challengeDetailFor(me, data.challengeId))

export const attemptChallenge = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(byId.extend({ teamId: z.uuid().optional() }))
  .handler(({ data, context }) => attemptChallengeFor(context.auth, data.challengeId, data.teamId))

export const setChallengeTeams = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(byId.extend({ teamIds: z.array(z.uuid()), tenantWide: z.boolean() }))
  .handler(({ data, context: { auth: me } }) => setChallengeTeamsFor(me, data.challengeId, { teamIds: data.teamIds, tenantWide: data.tenantWide }))

export const archiveChallenge = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(byId)
  .handler(({ data, context: { auth: me } }) => archiveChallengeFor(me, data.challengeId))
