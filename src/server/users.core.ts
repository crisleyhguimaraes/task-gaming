import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm'
import { db } from '#/db'
import type { Role } from '#/db/schema'
import { sessions, taskTimeLogs, tasks, teams, users } from '#/db/schema'
import { auth } from '#/lib/auth'
import { diffFields } from '#/lib/audit'
import { recordAudit } from './audit.core'
import type { AuthCtx } from './roles'
import { fail, requireCan } from './roles'
import { assertWithinScope, inTenantTeams } from './scope'
import { assertTeamInTenant } from './teams.core'
import { addMember, removeMember, teamRoleOf } from './team-members.core'
import { closeLogDuration } from './time'
import type { Reader, Tx } from './tx'

export type AssignableRole = Exclude<Role, 'SUPER_ADMIN'>

async function findUserInScope(tx: Reader, me: AuthCtx, userId: string) {
  const [u] = await tx.select().from(users).where(and(eq(users.id, userId), eq(users.tenantId, me.tenantId), ne(users.role, 'SUPER_ADMIN')))
  if (!u) fail('Usuário não encontrado')
  assertWithinScope(me, u)
  return u
}

export async function listUsersFor(me: AuthCtx) {
  requireCan(me, 'user.read')
  const list = await db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role, banned: users.banned, teamId: users.teamId, teamName: teams.name })
    .from(users)
    .leftJoin(teams, eq(teams.id, users.teamId))
    .where(and(inTenantTeams(users, me), ne(users.role, 'SUPER_ADMIN')))
    .orderBy(asc(users.name))
  const teamList = await db.select({ id: teams.id, name: teams.name }).from(teams).where(eq(teams.tenantId, me.tenantId)).orderBy(asc(teams.name))
  return { users: list, teams: teamList }
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

async function leaveTeam(tx: Tx, me: AuthCtx, user: { id: string; teamId: string | null }) {
  await releaseOpenWork(tx, user.id)
  if (user.teamId) await removeMember(tx, me, { teamId: user.teamId, userId: user.id })
}

/** Muda equipe/papel. Tarefas abertas na equipe antiga voltam pro pool (regra de órfãs). */
export async function updateUserCore(me: AuthCtx, data: { userId: string; teamId: string | null; role: AssignableRole }) {
  await db.transaction(async (tx) => {
    await assertTeamInTenant(tx, me.tenantId, data.teamId)
    const u = await findUserInScope(tx, me, data.userId)
    if (u.id === me.userId && u.role !== data.role) fail('Você não pode alterar o próprio papel')
    assertWithinScope(me, { role: data.role, teamId: data.teamId })
    if (u.teamId !== data.teamId) await leaveTeam(tx, me, u)
    const [updated] = await tx.update(users).set({ teamId: data.teamId, role: data.role }).where(eq(users.id, u.id)).returning()
    if (data.teamId) await addMember(tx, me, { teamId: data.teamId, userId: u.id, role: teamRoleOf(data.role) })
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
  assertWithinScope(me, data)
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
  // NOTE: o Better Auth cria o usuário fora da transação; se ela falhar sobra users.team_id sem vínculo, e addMember refaz o vínculo na próxima edição.
  await db.transaction(async (tx) => {
    if (data.teamId) await addMember(tx, me, { teamId: data.teamId, userId: user.id, role: teamRoleOf(data.role) })
    await recordAudit(tx, me, { action: 'user.created', entityType: 'user', entityId: user.id, meta: { email: data.email, role: data.role, teamId: data.teamId } })
  })
  return user
}
