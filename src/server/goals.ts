import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { authMiddleware } from './auth-context'
import { createGoalFor, deleteGoalFor, listGoalsFor, setGoalTeamsFor, updateGoalFor } from './goals.core'

const goalFields = { name: z.string(), targetPoints: z.number(), activeDays: z.array(z.number()) }
const goalId = z.object({ goalId: z.uuid() })

export const listGoals = createServerFn()
  .middleware([authMiddleware])
  .handler(({ context: { auth: me } }) => listGoalsFor(me))

export const createGoal = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object(goalFields))
  .handler(async ({ data, context: { auth: me } }) => {
    const goal = await createGoalFor(me, data)
    return { id: goal.id }
  })

export const updateGoal = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(goalId.extend(goalFields))
  .handler(async ({ data: { goalId: id, ...input }, context: { auth: me } }) => {
    await updateGoalFor(me, id, input)
  })

export const deleteGoal = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(goalId)
  .handler(({ data, context: { auth: me } }) => deleteGoalFor(me, data.goalId))

export const setGoalTeams = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(goalId.extend({ teamIds: z.array(z.uuid()) }))
  .handler(({ data, context: { auth: me } }) => setGoalTeamsFor(me, data.goalId, data.teamIds))
