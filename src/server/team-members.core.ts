import { and, eq, ne } from 'drizzle-orm'
import type { Role, TeamRole } from '#/db/schema'
import { teamMembers, users } from '#/db/schema'
import type { Actor } from './audit.core'
import { recordAudit } from './audit.core'
import { fail } from './roles'
import { assertTeamInTenant } from './teams.core'
import type { Tx } from './tx'

type Membership = { teamId: string; userId: string }

export const teamRoleOf = (role: Role): TeamRole => (role === 'TEAM_LEADER' ? 'LEADER' : 'MEMBER')

async function assertInTenant(tx: Tx, actor: Actor, { teamId, userId }: Membership) {
  await assertTeamInTenant(tx, actor.tenantId, teamId)
  const [user] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.tenantId, actor.tenantId), ne(users.role, 'SUPER_ADMIN')))
  if (!user) fail('Usuário não encontrado')
}

const isMember = ({ teamId, userId }: Membership) => and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId))

async function changeRole(tx: Tx, actor: Actor, membership: Membership & { role: TeamRole }) {
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

// Quem já é membro com outro papel só troca de papel: o dual-write de updateUserCore e o vínculo perdido quando o Better Auth cria o usuário e a transação seguinte falha caem aqui.
export async function addMember(tx: Tx, actor: Actor, membership: Membership & { role?: TeamRole }) {
  const { role = 'MEMBER' } = membership
  await assertInTenant(tx, actor, membership)
  const [added] = await tx
    .insert(teamMembers)
    .values({ teamId: membership.teamId, userId: membership.userId, tenantId: actor.tenantId, role })
    .onConflictDoNothing()
    .returning({ role: teamMembers.role })
  if (!added) return changeRole(tx, actor, { ...membership, role })
  await recordAudit(tx, actor, { action: 'team.member_added', entityType: 'team', entityId: membership.teamId, meta: { userId: membership.userId, role } })
}

export async function removeMember(tx: Tx, actor: Actor, membership: Membership) {
  await assertInTenant(tx, actor, membership)
  const [removed] = await tx.delete(teamMembers).where(isMember(membership)).returning({ role: teamMembers.role })
  if (!removed) return
  await recordAudit(tx, actor, { action: 'team.member_removed', entityType: 'team', entityId: membership.teamId, meta: { userId: membership.userId, role: removed.role } })
}

export async function setRole(tx: Tx, actor: Actor, membership: Membership & { role: TeamRole }) {
  await assertInTenant(tx, actor, membership)
  await changeRole(tx, actor, membership)
}
