import { createServerFn } from '@tanstack/react-start'
import { and, asc, eq, ne } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '#/db'
import { teams, users } from '#/db/schema'
import { authMiddleware, requireCan } from './auth-context'
import type { AuthCtx } from './roles'
import { isAdmin } from './roles'
import { createUserFor, deactivateUserCore, reactivateUserCore, updateUserCore } from './users.core'

const assignableRoles = z.enum(['TENANT_ADMIN', 'TEAM_LEADER', 'MEMBER'])

const scope = (me: AuthCtx) =>
  isAdmin(me) ? eq(users.tenantId, me.tenantId) : and(eq(users.tenantId, me.tenantId), eq(users.teamId, me.teamId ?? ''))

export const listUsers = createServerFn()
  .middleware([authMiddleware])
  .handler(async ({ context: { auth: me } }) => {
    requireCan(me, 'user.read')
    const list = await db
      .select({ id: users.id, name: users.name, email: users.email, role: users.role, banned: users.banned, teamId: users.teamId, teamName: teams.name })
      .from(users)
      .leftJoin(teams, eq(teams.id, users.teamId))
      .where(and(scope(me), ne(users.role, 'SUPER_ADMIN')))
      .orderBy(asc(users.name))
    const teamList = await db.select({ id: teams.id, name: teams.name }).from(teams).where(eq(teams.tenantId, me.tenantId)).orderBy(asc(teams.name))
    return { users: list, teams: teamList }
  })

export const createUser = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(
    z.object({
      name: z.string().trim().min(2).max(120),
      email: z.email(),
      password: z.string().min(8),
      teamId: z.uuid().nullable(),
      role: assignableRoles,
    }),
  )
  .handler(async ({ data, context: { auth: me } }) => {
    requireCan(me, 'user.create')
    await createUserFor(me, data)
  })

export const updateUser = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ userId: z.string(), teamId: z.uuid().nullable(), role: assignableRoles }))
  .handler(({ data, context: { auth: me } }) => {
    requireCan(me, 'user.update')
    return updateUserCore(me, data)
  })

export const deactivateUser = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ userId: z.string(), reason: z.string().trim().max(200).optional() }))
  .handler(({ data, context: { auth: me } }) => deactivateUserCore(me, data.userId, data.reason))

export const reactivateUser = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ userId: z.string() }))
  .handler(({ data, context: { auth: me } }) => reactivateUserCore(me, data.userId))

export const clearMustChangePassword = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .handler(async ({ context: { auth: me } }) => {
    await db.update(users).set({ mustChangePassword: false }).where(eq(users.id, me.userId))
  })
