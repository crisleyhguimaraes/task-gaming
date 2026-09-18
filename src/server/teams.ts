import { createServerFn } from '@tanstack/react-start'
import { and, asc, count, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '#/db'
import { tasks, teams, users } from '#/db/schema'
import { authMiddleware, requireRole } from './auth-context'

export const listTeams = createServerFn()
  .middleware([authMiddleware])
  .handler(async ({ context: { auth: me } }) => {
    requireRole(me, 'SUPER_ADMIN', 'TENANT_ADMIN')
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
  .handler(async ({ data, context: { auth: me } }) => {
    requireRole(me, 'SUPER_ADMIN', 'TENANT_ADMIN')
    const [t] = await db.insert(teams).values({ tenantId: me.tenantId, name: data.name }).returning()
    return t!
  })

export const deleteTeam = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ teamId: z.uuid() }))
  .handler(async ({ data, context: { auth: me } }) => {
    requireRole(me, 'SUPER_ADMIN', 'TENANT_ADMIN')
    const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(tasks).where(eq(tasks.teamId, data.teamId))
    if (n > 0) throw new Error('Equipe tem tarefas; não pode ser excluída')
    await db.delete(teams).where(and(eq(teams.id, data.teamId), eq(teams.tenantId, me.tenantId)))
  })
