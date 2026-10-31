import { and, asc, eq, inArray, ne } from 'drizzle-orm'
import { db } from '#/db'
import type { Role } from '#/db/schema'
import { sessions, teamMembers, teams, users } from '#/db/schema'
import { auth } from '#/lib/auth'
import { diffFields } from '#/lib/audit'
import { recordAudit } from './audit.core'
import type { AuthCtx, Capability } from './roles'
import { fail, requireCan } from './roles'
import { assertWithinScope, teamIdsFrom, usersInScope } from './scope'
import { assertTeamInTenant } from './teams.core'
import { addMember, removeMember, teamIdsOfUser, teamRoleOf } from './team-members.core'
import { releaseOpenWork } from './tasks.core'
import type { Reader } from './tx'

export type AssignableRole = Exclude<Role, 'SUPER_ADMIN'>

async function findUserInScope(tx: Reader, me: AuthCtx, userId: string, capability: Capability) {
  const [u] = await tx.select().from(users).where(and(eq(users.id, userId), eq(users.tenantId, me.tenantId), ne(users.role, 'SUPER_ADMIN')))
  if (!u) fail('Usuário não encontrado')
  assertWithinScope(me, { role: u.role, teamIds: await teamIdsOfUser(tx, u.id) }, capability)
  return u
}

export async function listUsersFor(me: AuthCtx) {
  requireCan(me, 'user.read')
  const list = await db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role, banned: users.banned })
    .from(users)
    .where(and(usersInScope(me, { capability: 'user.read' }), ne(users.role, 'SUPER_ADMIN')))
    .orderBy(asc(users.name))
  const links = await db
    .select({ userId: teamMembers.userId, teamId: teamMembers.teamId, teamName: teams.name, role: teamMembers.role })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(and(eq(teamMembers.tenantId, me.tenantId), inArray(teamMembers.userId, list.map((u) => u.id))))
    .orderBy(asc(teams.name))
  const teamList = await db.select({ id: teams.id, name: teams.name }).from(teams).where(eq(teams.tenantId, me.tenantId)).orderBy(asc(teams.name))
  return {
    users: list.map((u) => ({ ...u, memberships: links.filter((l) => l.userId === u.id).map(({ teamId, teamName, role }) => ({ teamId, teamName, role })) })),
    teams: teamList,
  }
}

/** Muda equipe/papel. Tarefas abertas na equipe antiga voltam pro pool (regra de órfãs). */
export async function updateUserCore(me: AuthCtx, data: { userId: string; teamId: string | null; role: AssignableRole }) {
  await db.transaction(async (tx) => {
    await assertTeamInTenant(tx, me.tenantId, data.teamId)
    const u = await findUserInScope(tx, me, data.userId, 'user.update')
    if (u.id === me.userId && u.role !== data.role) fail('Você não pode alterar o próprio papel')
    assertWithinScope(me, { role: data.role, teamIds: teamIdsFrom(data.teamId) }, 'user.update')
    // NOTE: a tela edita uma equipe só, a de users.team_id; a 1b-iii a troca por vínculos e a 1c remove a coluna.
    if (u.teamId && u.teamId !== data.teamId) await removeMember(tx, me, { teamId: u.teamId, userId: u.id })
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
    const u = await findUserInScope(tx, me, userId, 'user.deactivate')
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
    const u = await findUserInScope(tx, me, userId, 'user.deactivate')
    if (!u.banned) return
    await tx.update(users).set({ banned: false, banReason: null, banExpires: null }).where(eq(users.id, u.id))
    await recordAudit(tx, me, { action: 'user.reactivated', entityType: 'user', entityId: u.id })
  })
}

export async function createUserFor(me: AuthCtx, data: { name: string; email: string; password: string; teamId: string | null; role: AssignableRole }) {
  assertWithinScope(me, { role: data.role, teamIds: teamIdsFrom(data.teamId) }, 'user.create')
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
