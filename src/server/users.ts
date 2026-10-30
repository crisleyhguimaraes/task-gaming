import { createServerFn } from '@tanstack/react-start'
import { and, asc, eq, ne } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '#/db'
import { teams, users } from '#/db/schema'
import { auth } from '#/lib/auth'
import { authMiddleware, requireRole } from './auth-context'
import type { AuthCtx } from './roles'
import { isAdmin } from './roles'
import { assertTeamInTenant } from './teams.core'
import { updateUserCore } from './users.core'

const assignableRoles = z.enum(['TENANT_ADMIN', 'TEAM_LEADER', 'MEMBER'])

const scope = (me: AuthCtx) =>
  isAdmin(me) ? eq(users.tenantId, me.tenantId) : and(eq(users.tenantId, me.tenantId), eq(users.teamId, me.teamId ?? ''))

export const listUsers = createServerFn()
  .middleware([authMiddleware])
  .handler(async ({ context: { auth: me } }) => {
    requireRole(me, 'SUPER_ADMIN', 'TENANT_ADMIN', 'TEAM_LEADER')
    const list = await db
      .select({ id: users.id, name: users.name, email: users.email, role: users.role, teamId: users.teamId, teamName: teams.name })
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
    requireRole(me, 'SUPER_ADMIN', 'TENANT_ADMIN', 'TEAM_LEADER')
    if (me.role === 'TEAM_LEADER' && (data.role !== 'MEMBER' || data.teamId !== me.teamId)) throw new Error('Líder só cria membros da própria equipe')
    await assertTeamInTenant(db, me.tenantId, data.teamId)
    await auth.api.createUser({
      body: {
        name: data.name,
        email: data.email,
        password: data.password,
        role: data.role,
        data: { tenantId: me.tenantId, teamId: data.teamId ?? undefined, mustChangePassword: true },
      },
    })
  })

export const updateUser = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ userId: z.string(), teamId: z.uuid().nullable(), role: assignableRoles }))
  .handler(({ data, context: { auth: me } }) => {
    requireRole(me, 'SUPER_ADMIN', 'TENANT_ADMIN')
    return updateUserCore(me, data)
  })

export const clearMustChangePassword = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .handler(async ({ context: { auth: me } }) => {
    await db.update(users).set({ mustChangePassword: false }).where(eq(users.id, me.userId))
  })
