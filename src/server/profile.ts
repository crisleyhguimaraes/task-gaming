import { createServerFn } from '@tanstack/react-start'
import { and, count, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '#/db'
import { tasks, users } from '#/db/schema'
import { authMiddleware } from './auth-context'
import { streak, tenantSettings, totalPoints } from './stats'
import { teamsOfUser } from './team-members.core'

export const getProfile = createServerFn()
  .middleware([authMiddleware])
  .handler(async ({ context: { auth: me } }) => {
    const [u] = await db
      .select({ name: users.name, email: users.email, createdAt: users.createdAt })
      .from(users)
      .where(eq(users.id, me.userId))
    const { timezone } = await tenantSettings(me.tenantId)
    const [done] = await db
      .select({ n: count() })
      .from(tasks)
      .where(and(eq(tasks.assignedToId, me.userId), eq(tasks.status, 'finished')))
    return {
      name: u?.name ?? me.name,
      email: u?.email ?? '',
      teams: await teamsOfUser(db, me.userId),
      memberSince: u?.createdAt ?? new Date(),
      totalPoints: await totalPoints(me.userId),
      streak: await streak(me.userId, timezone),
      finished: done?.n ?? 0,
    }
  })

export const updateProfile = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ name: z.string().trim().min(2).max(120) }))
  .handler(async ({ data, context: { auth: me } }) => {
    await db.update(users).set({ name: data.name }).where(eq(users.id, me.userId))
  })
