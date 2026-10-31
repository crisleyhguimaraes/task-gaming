import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { authMiddleware } from './auth-context'
import type { ScoringRules } from './scoring'
import { createScoringRuleFor, deleteScoringRuleFor, listScoringRulesFor, setScoringRuleTeamsFor, updateScoringRuleFor } from './scoring-rules.core'

const rules = z.object({
  validateBelowPct: z.number(),
  paceBelowPct: z.number(),
  paceBonusPct: z.number(),
  overtimeAbovePct: z.number(),
  overtimeStepPct: z.number(),
  overtimePenaltyPct: z.number(),
  pauseBelowPct: z.number(),
  pausePenaltyPct: z.number(),
  floorPct: z.number(),
  capMultiplier: z.number(),
  capMinMinutes: z.number(),
}) satisfies z.ZodType<ScoringRules>
const ruleFields = { name: z.string(), rules }
const scoringRuleId = z.object({ scoringRuleId: z.uuid() })

export const listScoringRules = createServerFn()
  .middleware([authMiddleware])
  .handler(({ context: { auth: me } }) => listScoringRulesFor(me))

export const createScoringRule = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object(ruleFields))
  .handler(async ({ data, context: { auth: me } }) => {
    const rule = await createScoringRuleFor(me, data)
    return { id: rule.id }
  })

export const updateScoringRule = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(scoringRuleId.extend(ruleFields))
  .handler(async ({ data: { scoringRuleId: id, ...input }, context: { auth: me } }) => {
    await updateScoringRuleFor(me, id, input)
  })

export const deleteScoringRule = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(scoringRuleId)
  .handler(({ data, context: { auth: me } }) => deleteScoringRuleFor(me, data.scoringRuleId))

export const setScoringRuleTeams = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(scoringRuleId.extend({ teamIds: z.array(z.uuid()) }))
  .handler(({ data, context: { auth: me } }) => setScoringRuleTeamsFor(me, data.scoringRuleId, data.teamIds))
