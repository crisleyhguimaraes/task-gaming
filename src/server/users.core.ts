import { and, eq, inArray, isNull, ne } from 'drizzle-orm'
import { db } from '#/db'
import type { Role } from '#/db/schema'
import { taskTimeLogs, tasks, users } from '#/db/schema'
import type { AuthCtx } from './roles'
import { fail } from './roles'
import { assertTeamInTenant } from './teams.core'
import { closeLogDuration } from './time'

export type AssignableRole = Exclude<Role, 'SUPER_ADMIN'>

/** Muda equipe/papel. Tarefas abertas na equipe antiga voltam pro pool (regra de órfãs). */
export async function updateUserCore(me: AuthCtx, data: { userId: string; teamId: string | null; role: AssignableRole }) {
  await db.transaction(async (tx) => {
    await assertTeamInTenant(tx, me.tenantId, data.teamId)
    const [u] = await tx.select().from(users).where(and(eq(users.id, data.userId), eq(users.tenantId, me.tenantId), ne(users.role, 'SUPER_ADMIN')))
    if (!u) fail('Usuário não encontrado')
    if (u.id === me.userId && u.role !== data.role) fail('Você não pode alterar o próprio papel')
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
}
