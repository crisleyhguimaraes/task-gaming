import { and, asc, eq, ne } from 'drizzle-orm'
import { db } from '#/db'
import type { TeamRole } from '#/db/schema'
import { teamMembers, teams, users } from '#/db/schema'
import type { Actor } from './audit.core'
import { recordAudit } from './audit.core'
import type { AuthCtx } from './roles'
import { canManage, fail, forbid, isAdmin, requireCan } from './roles'
import { releaseOwnedRecords } from './leads.core'
import { assertTeamInTenant } from './teams.core'
import { releaseOpenWork } from './tasks.core'
import type { Reader, Tx } from './tx'

type Membership = { teamId: string; userId: string }
type RoleAssignment = Membership & { role: TeamRole }

async function assertInTenant(tx: Tx, actor: Actor, { teamId, userId }: Membership) {
  await assertTeamInTenant(tx, actor.tenantId, teamId)
  const [user] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.tenantId, actor.tenantId), ne(users.role, 'SUPER_ADMIN')))
  if (!user) fail('Usuário não encontrado')
}

export const teamsOfUser = (tx: Reader, userId: string) =>
  tx
    .select({ id: teams.id, name: teams.name, role: teamMembers.role })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(eq(teamMembers.userId, userId))
    .orderBy(asc(teams.name))

const isMember = ({ teamId, userId }: Membership) => and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId))

const memberRole = async (tx: Reader, membership: Membership) =>
  (await tx.select({ role: teamMembers.role }).from(teamMembers).where(isMember(membership)))[0]?.role ?? null

// Quem já é membro com outro papel não muda de papel por aqui: a troca é de setRole, que só o admin faz.
export async function addMember(tx: Tx, actor: Actor, membership: Membership & { role?: TeamRole }) {
  const { role = 'MEMBER' } = membership
  await assertInTenant(tx, actor, membership)
  const [added] = await tx
    .insert(teamMembers)
    .values({ teamId: membership.teamId, userId: membership.userId, tenantId: actor.tenantId, role })
    .onConflictDoNothing()
    .returning({ role: teamMembers.role })
  if (added) {
    await recordAudit(tx, actor, { action: 'team.member_added', entityType: 'team', entityId: membership.teamId, meta: { userId: membership.userId, role } })
    return
  }
  const current = await memberRole(tx, membership)
  if (current !== role) fail('A pessoa já está na equipe com outro papel')
}

export async function removeMember(tx: Tx, actor: Actor, membership: Membership) {
  await assertInTenant(tx, actor, membership)
  const [removed] = await tx.delete(teamMembers).where(isMember(membership)).returning({ role: teamMembers.role })
  if (!removed) return
  await releaseOpenWork(tx, membership.userId, membership.teamId)
  const released = await releaseOwnedRecords(tx, membership.userId, membership.teamId)
  await recordAudit(tx, actor, { action: 'team.member_removed', entityType: 'team', entityId: membership.teamId, meta: { userId: membership.userId, role: removed.role, ...released } })
}

export async function setRole(tx: Tx, actor: Actor, membership: RoleAssignment) {
  await assertInTenant(tx, actor, membership)
  const [current] = await tx.select({ role: teamMembers.role }).from(teamMembers).where(isMember(membership)).for('update')
  if (!current) fail('Usuário não é membro da equipe')
  if (current.role === membership.role) return
  await tx.update(teamMembers).set({ role: membership.role }).where(isMember(membership))
  await recordAudit(tx, actor, {
    action: 'team.member_role_changed',
    entityType: 'team',
    entityId: membership.teamId,
    meta: { userId: membership.userId, role: membership.role },
    changes: { role: { from: current.role, to: membership.role } },
  })
}

/** Repetir o vínculo com o mesmo papel não faz nada. Só admin promove a líder; quem tem a capability na equipe (delegada ao líder) só adiciona membro. */
export async function addTeamMemberFor(me: AuthCtx, change: RoleAssignment) {
  requireCan(me, 'team.member.manage', change.teamId)
  if (change.role === 'LEADER' && !isAdmin(me)) forbid()
  await db.transaction((tx) => addMember(tx, me, change))
}

/** Admin tira qualquer um; o líder tira membro da própria equipe, nunca um líder (nem a si mesmo). */
export async function removeTeamMemberFor(me: AuthCtx, membership: Membership) {
  if (!canManage(me, membership)) forbid()
  await db.transaction(async (tx) => {
    // FOR UPDATE: uma promoção concorrente a líder espera, e o líder deixa de poder tirar quem acabou de ser promovido.
    const [target] = await tx.select({ role: teamMembers.role }).from(teamMembers).where(isMember(membership)).for('update')
    if (target?.role === 'LEADER' && !isAdmin(me)) forbid()
    await removeMember(tx, me, membership)
  })
}

export async function setTeamMemberRoleFor(me: AuthCtx, change: RoleAssignment) {
  if (!isAdmin(me)) forbid()
  await db.transaction((tx) => setRole(tx, me, change))
}
