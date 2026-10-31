import type { AssignableRole, TeamRole } from '#/lib/access'
import type { AuthCtx } from '#/server/roles'
import { can, canManage, isAdmin } from '#/server/roles'
import type { listUsers } from '#/server/users'

type UsersData = Awaited<ReturnType<typeof listUsers>>
export type UserRow = UsersData['users'][number]
export type Team = UsersData['teams'][number]
export type Membership = UserRow['memberships'][number]
export type Act = (fn: () => Promise<unknown>) => Promise<void>

export const teamRoleLabel: Record<TeamRole, string> = { LEADER: 'Líder', MEMBER: 'Membro' }

export const tenantRoleOf = (value: unknown): AssignableRole => (value === 'TENANT_ADMIN' ? 'TENANT_ADMIN' : 'MEMBER')
export const teamRoleOf = (value: unknown): TeamRole => (value === 'LEADER' ? 'LEADER' : 'MEMBER')

export function readPlacement(form: FormData) {
  const teamId = String(form.get('teamId') ?? '') || null
  return { teamId, role: tenantRoleOf(form.get('role')), teamRole: teamId ? teamRoleOf(form.get('teamRole')) : 'MEMBER' } as const
}

export const teamsWhereCan = (me: AuthCtx, teams: ReadonlyArray<Team>, capability: 'user.create' | 'invitation.manage') =>
  teams.filter((t) => can(me, capability, t.id))

/** Líder só tira MEMBER; o vínculo de líder é do admin. */
export const canRemoveFromTeam = (me: AuthCtx, link: Membership) =>
  canManage(me, link) && (isAdmin(me) || link.role === 'MEMBER')

/** Fora do admin, a ação vale para a pessoa inteira: só membro comum cujas equipes estão todas no meu escopo. */
export function canDeactivate(me: AuthCtx, user: UserRow) {
  if (user.id === me.userId || !can(me, 'user.deactivate')) return false
  if (isAdmin(me)) return true
  return user.role === 'MEMBER' && user.memberships.length > 0 && user.memberships.every((m) => m.role === 'MEMBER' && can(me, 'user.deactivate', m.teamId))
}
