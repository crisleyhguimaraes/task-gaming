import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { authMiddleware, requireCan } from './auth-context'
import { createTeamFor, deleteTeamFor, listTeamsFor, teamDetailFor, updateTeamFor } from './teams.core'

export const listTeams = createServerFn()
  .middleware([authMiddleware])
  .handler(({ context: { auth: me } }) => {
    requireCan(me, 'team.manage')
    return listTeamsFor(me)
  })

export const getTeamDetail = createServerFn()
  .middleware([authMiddleware])
  .validator(z.object({ teamId: z.uuid() }))
  .handler(({ data, context: { auth: me } }) => teamDetailFor(me, data.teamId))

export const createTeam = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ name: z.string().trim().min(2).max(100) }))
  .handler(({ data, context: { auth: me } }) => createTeamFor(me, data.name))

export const updateTeam = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ teamId: z.uuid(), name: z.string().trim().min(2).max(100), description: z.string().trim().max(300) }))
  .handler(async ({ data, context: { auth: me } }) => {
    await updateTeamFor(me, data.teamId, data)
  })

export const deleteTeam = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ teamId: z.uuid() }))
  .handler(({ data, context: { auth: me } }) => deleteTeamFor(me, data.teamId))
