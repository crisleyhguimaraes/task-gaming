import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '#/db'
import { users } from '#/db/schema'
import { assignableRoles, teamRoles } from '#/lib/access'
import { authMiddleware, requireCan } from './auth-context'
import { createUserFor, deactivateUserCore, listUsersFor, reactivateUserCore, updateUserCore } from './users.core'

export const listUsers = createServerFn()
  .middleware([authMiddleware])
  .handler(({ context: { auth: me } }) => listUsersFor(me))

export const createUser = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(
    z.object({
      name: z.string().trim().min(2).max(120),
      email: z.email(),
      password: z.string().min(8),
      teamId: z.uuid().nullable(),
      role: z.enum(assignableRoles),
      teamRole: z.enum(teamRoles).default('MEMBER'),
    }),
  )
  .handler(async ({ data, context: { auth: me } }) => {
    requireCan(me, 'user.create')
    await createUserFor(me, data)
  })

export const updateUser = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ userId: z.string(), role: z.enum(assignableRoles) }))
  .handler(({ data, context: { auth: me } }) => updateUserCore(me, data))

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
