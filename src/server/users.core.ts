import { and, eq, inArray, isNull, ne } from 'drizzle-orm'
import { db } from '#/db'
import type { Role } from '#/db/schema'
import { sessions, taskTimeLogs, tasks, users } from '#/db/schema'
import { auth } from '#/lib/auth'
import { diffFields } from '#/lib/audit'
import { recordAudit } from './audit.core'
import type { AuthCtx } from './roles'
import { fail, forbid, isAdmin, requireCan } from './roles'
import { assertTeamInTenant } from './teams.core'
import { closeLogDuration } from './time'

export type AssignableRole = Exclude<Role, 'SUPER_ADMIN'>

type Reader = Pick<typeof db, 'select'>

/** Quem não é admin só gerencia membros comuns da própria equipe: capability delegada não pode virar escalada de privilégio. */
function assertWithinScope(me: AuthCtx, target: Pick<typeof users.$inferSelect, 'role' | 'teamId'>) {
  if (isAdmin(me)) return
  if (target.role !== 'MEMBER' || target.teamId !== me.teamId) forbid()
}

async function findUserInScope(tx: Reader, me: AuthCtx, userId: string) {
  const [u] = await tx.select().from(users).where(and(eq(users.id, userId), eq(users.tenantId, me.tenantId), ne(users.role, 'SUPER_ADMIN')))
  if (!u) fail('Usuário não encontrado')
  assertWithinScope(me, u)
  return u
}

export async function releaseOpenWork(tx: Pick<typeof db, 'select' | 'update'>, userId: string) {
  const now = new Date()
  const open = await tx
    .select({ id: taskTimeLogs.id, startedAt: taskTimeLogs.startedAt, est: tasks.estimatedSeconds })
    .from(taskTimeLogs)
    .innerJoin(tasks, eq(tasks.id, taskTimeLogs.taskId))
    .where(and(eq(taskTimeLogs.userId, userId), isNull(taskTimeLogs.stoppedAt)))
  for (const l of open) {
    await tx.update(taskTimeLogs).set({ stoppedAt: now, durationSeconds: closeLogDuration(l.startedAt, now, l.est) }).where(eq(taskTimeLogs.id, l.id))
  }
  await tx
    .update(tasks)
    .set({ assignedToId: null, status: 'pending' })
    .where(and(eq(tasks.assignedToId, userId), inArray(tasks.status, ['pending', 'in_progress', 'paused'])))
}

/** Muda equipe/papel. Tarefas abertas na equipe antiga voltam pro pool (regra de órfãs). */
export async function updateUserCore(me: AuthCtx, data: { userId: string; teamId: string | null; role: AssignableRole }) {
  await db.transaction(async (tx) => {
    await assertTeamInTenant(tx, me.tenantId, data.teamId)
    const u = await findUserInScope(tx, me, data.userId)
    if (u.id === me.userId && u.role !== data.role) fail('Você não pode alterar o próprio papel')
    if (!isAdmin(me) && data.role !== 'MEMBER') forbid()
    if (u.teamId !== data.teamId) await releaseOpenWork(tx, u.id)
    const [updated] = await tx.update(users).set({ teamId: data.teamId, role: data.role }).where(eq(users.id, u.id)).returning()
    const changes = diffFields(u, updated!, ['role', 'teamId'])
    if (Object.keys(changes).length) await recordAudit(tx, me, { action: 'user.updated', entityType: 'user', entityId: u.id, changes })
  })
}

export async function deactivateUserCore(me: AuthCtx, userId: string, reason?: string) {
  requireCan(me, 'user.deactivate')
  if (userId === me.userId) fail('Você não pode desativar a si mesmo')
  await db.transaction(async (tx) => {
    const u = await findUserInScope(tx, me, userId)
    if (u.banned) return
    await tx.update(users).set({ banned: true, banReason: reason || null }).where(eq(users.id, u.id))
    await tx.delete(sessions).where(eq(sessions.userId, u.id))
    await releaseOpenWork(tx, u.id)
    await recordAudit(tx, me, { action: 'user.deactivated', entityType: 'user', entityId: u.id, meta: reason ? { reason } : undefined })
  })
}

export async function reactivateUserCore(me: AuthCtx, userId: string) {
  requireCan(me, 'user.deactivate')
  await db.transaction(async (tx) => {
    const u = await findUserInScope(tx, me, userId)
    if (!u.banned) return
    await tx.update(users).set({ banned: false, banReason: null, banExpires: null }).where(eq(users.id, u.id))
    await recordAudit(tx, me, { action: 'user.reactivated', entityType: 'user', entityId: u.id })
  })
}

export async function createUserFor(me: AuthCtx, data: { name: string; email: string; password: string; teamId: string | null; role: AssignableRole }) {
  if (me.role === 'TEAM_LEADER' && (data.role !== 'MEMBER' || data.teamId !== me.teamId)) fail('Líder só cria membros da própria equipe')
  await assertTeamInTenant(db, me.tenantId, data.teamId)
  const { user } = await auth.api.createUser({
    body: {
      name: data.name,
      email: data.email,
      password: data.password,
      role: data.role,
      data: { tenantId: me.tenantId, teamId: data.teamId ?? undefined, mustChangePassword: true },
    },
  })
  await recordAudit(db, me, { action: 'user.created', entityType: 'user', entityId: user.id, meta: { email: data.email, role: data.role, teamId: data.teamId } })
  return user
}
