import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '#/db'
import { users } from '#/db/schema'
import { authMiddleware } from './auth-context'
import { finishedCount, streak, tenantSettings, totalPoints } from './stats'
import { teamsOfUser } from './team-members.core'

export const getProfile = createServerFn()
  .middleware([authMiddleware])
  .handler(async ({ context: { auth: me } }) => {
    const [u] = await db
      .select({ name: users.name, email: users.email, createdAt: users.createdAt })
      .from(users)
      .where(eq(users.id, me.userId))
    const { timezone } = await tenantSettings(me.tenantId)
    return {
      name: u?.name ?? me.name,
      email: u?.email ?? '',
      teams: await teamsOfUser(db, me.userId),
      memberSince: u?.createdAt ?? new Date(),
      totalPoints: await totalPoints(me.userId),
      streak: await streak(me.userId, timezone),
      finished: await finishedCount(me.userId),
    }
  })

export const updateProfile = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ name: z.string().trim().min(2).max(120) }))
  .handler(async ({ data, context: { auth: me } }) => {
    await db.update(users).set({ name: data.name }).where(eq(users.id, me.userId))
  })
