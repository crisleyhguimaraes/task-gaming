import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { authMiddleware, requireCan } from './auth-context'
import { createTeamFor, deleteTeamFor, listTeamsFor } from './teams.core'

export const listTeams = createServerFn()
  .middleware([authMiddleware])
  .handler(({ context: { auth: me } }) => {
    requireCan(me, 'team.manage')
    return listTeamsFor(me)
  })

export const createTeam = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ name: z.string().trim().min(2).max(100) }))
  .handler(({ data, context: { auth: me } }) => {
    requireCan(me, 'team.manage')
    return createTeamFor(me, data.name)
  })

export const deleteTeam = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ teamId: z.uuid() }))
  .handler(({ data, context: { auth: me } }) => {
    requireCan(me, 'team.manage')
    return deleteTeamFor(me, data.teamId)
  })
