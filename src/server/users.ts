import { createServerFn } from '@tanstack/react-start'
import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '#/db'
import { taskTimeLogs, tasks, teams, users } from '#/db/schema'
import { auth } from '#/lib/auth'
import { authMiddleware, requireRole } from './auth-context'
import type { AuthCtx } from './roles'
import { isAdmin } from './roles'
import { closeLogDuration } from './time'

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
    if (data.teamId) {
      const [t] = await db.select({ id: teams.id }).from(teams).where(and(eq(teams.id, data.teamId), eq(teams.tenantId, me.tenantId)))
      if (!t) throw new Error('Equipe não encontrada')
    }
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

/** Muda equipe/papel. Tarefas abertas na equipe antiga voltam pro pool (regra de órfãs). */
export const updateUser = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ userId: z.string(), teamId: z.uuid().nullable(), role: assignableRoles }))
  .handler(async ({ data, context: { auth: me } }) => {
    requireRole(me, 'SUPER_ADMIN', 'TENANT_ADMIN')
    await db.transaction(async (tx) => {
      const [u] = await tx.select().from(users).where(and(eq(users.id, data.userId), eq(users.tenantId, me.tenantId), ne(users.role, 'SUPER_ADMIN')))
      if (!u) throw new Error('Usuário não encontrado')
      if (u.teamId !== data.teamId) {
        const now = new Date()
        const open = await tx
          .select({ id: taskTimeLogs.id, startedAt: taskTimeLogs.startedAt, est: tasks.estimatedSeconds })
          .from(taskTimeLogs)
          .innerJoin(tasks, eq(tasks.id, taskTimeLogs.taskId))
          .where(and(eq(taskTimeLogs.userId, u.id), isNull(taskTimeLogs.stoppedAt)))
        for (const l of open) {
          await tx.update(taskTimeLogs).set({ stoppedAt: now, durationSeconds: closeLogDuration(l.startedAt, now, l.est) }).where(eq(taskTimeLogs.id, l.id))
        }
        await tx
          .update(tasks)
          .set({ assignedToId: null, status: 'pending' })
          .where(and(eq(tasks.assignedToId, u.id), inArray(tasks.status, ['pending', 'in_progress', 'paused'])))
      }
      await tx.update(users).set({ teamId: data.teamId, role: data.role }).where(eq(users.id, u.id))
    })
  })

export const clearMustChangePassword = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .handler(async ({ context: { auth: me } }) => {
    await db.update(users).set({ mustChangePassword: false }).where(eq(users.id, me.userId))
  })
