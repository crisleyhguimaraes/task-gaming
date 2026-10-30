import { createServerFn } from '@tanstack/react-start'
import { asc, count, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '#/db'
import { teams, users } from '#/db/schema'
import { authMiddleware, requireCan } from './auth-context'
import { createTeamFor, deleteTeamFor } from './teams.core'

export const listTeams = createServerFn()
  .middleware([authMiddleware])
  .handler(async ({ context: { auth: me } }) => {
    requireCan(me, 'team.manage')
    return db
      .select({ id: teams.id, name: teams.name, members: count(users.id) })
      .from(teams)
      .leftJoin(users, eq(users.teamId, teams.id))
      .where(eq(teams.tenantId, me.tenantId))
      .groupBy(teams.id)
      .orderBy(asc(teams.name))
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
