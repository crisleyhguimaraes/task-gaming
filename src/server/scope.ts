import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'
import type { Role, TeamRole } from '#/lib/access'
import { teamMembers, users } from '#/db/schema'
import type { AuthCtx, Capability } from './roles'
import { can, fail, forbid, isAdmin, managedTeamIds } from './roles'
import type { Reader, Tx } from './tx'

type ScopeOptions = { only?: string; capability?: Capability }

/** `'all'` é o tenant inteiro (admin); do contrário, as equipes dos vínculos, só as onde `capability` vale quando ela é dada. */
export function teamIdsOf(me: AuthCtx, capability?: Capability): 'all' | ReadonlyArray<string> {
  const allowed = (teamId?: string) => !capability || can(me, capability, teamId)
  if (isAdmin(me)) return allowed() ? 'all' : []
  return me.memberships.filter((m) => allowed(m.teamId)).map((m) => m.teamId)
}

/** Filtro pelas equipes onde `me` tem vínculo; ao contrário de `inTeams`, o admin não vê o tenant todo. */
export const inMemberTeams = (column: PgColumn, me: AuthCtx) => inArray(column, me.memberships.map((m) => m.teamId))

/** Filtro pelas equipes que `me` gerencia; admin, o tenant (sem filtro de equipe). */
export const inManagedTeams = (column: PgColumn, me: AuthCtx) => (isAdmin(me) ? undefined : inArray(column, managedTeamIds(me)))

/** `only` restringe a uma equipe, e equipe alheia dá vazio. */
function scopedTeamIds(me: AuthCtx, { only, capability }: ScopeOptions) {
  const ids = teamIdsOf(me, capability)
  if (ids === 'all') return only ? [only] : ids
  return ids.filter((id) => !only || id === only)
}

/** Filtro de equipe pela visibilidade de `me`; admin não ganha filtro. */
export function inTeams(column: PgColumn, me: AuthCtx, options: ScopeOptions = {}) {
  const ids = scopedTeamIds(me, options)
  return ids === 'all' ? undefined : inArray(column, [...ids])
}

/** Admin continua preso ao próprio tenant: nunca use `inTeams` sozinho numa tabela de vários tenants. */
export function inTenantTeams(table: { tenantId: PgColumn; teamId: PgColumn }, me: AuthCtx, options?: ScopeOptions) {
  return and(eq(table.tenantId, me.tenantId), inTeams(table.teamId, me, options))
}

const memberOf = (teamIds: ReadonlyArray<string>) =>
  sql`exists (select 1 from ${teamMembers} where ${teamMembers.userId} = ${users.id} and ${inArray(teamMembers.teamId, [...teamIds])})`

/** Usuários do tenant que `me` enxerga: admin, todos; os demais, quem divide uma equipe com ele. */
export function usersInScope(me: AuthCtx, options: ScopeOptions = {}) {
  const ids = scopedTeamIds(me, options)
  return and(eq(users.tenantId, me.tenantId), ids === 'all' ? undefined : memberOf(ids))
}

export const teamIdsFrom = (teamId: string | null) => (teamId ? [teamId] : [])

/** Quem não é admin só age sobre membro comum (de tenant e de equipe) e só se todas as equipes da pessoa estiverem no seu escopo: a ação vale para ela inteira, não por equipe. */
export function assertWithinScope(me: AuthCtx, target: { role: Role; teamRole: TeamRole; teamIds: ReadonlyArray<string> }, capability: Capability) {
  const ids = teamIdsOf(me, capability)
  if (ids === 'all') return
  const allInScope = target.teamIds.length > 0 && target.teamIds.every((id) => ids.includes(id))
  if (target.role !== 'MEMBER' || target.teamRole !== 'MEMBER' || !allInScope) forbid()
}

/** Regra única de "responsável ativo": membro da equipe, do tenant, e não desativado. */
export const activeMembersOf = (tenantId: string, teamIds: ReadonlyArray<string>) =>
  and(eq(users.tenantId, tenantId), memberOf(teamIds), eq(users.banned, false))

/** Responsáveis ativos com uma linha por (pessoa, equipe): quem está em várias aparece em cada uma. */
export function activeMembersByTeam(tx: Reader, tenantId: string, teamIds: ReadonlyArray<string>) {
  return tx
    .select({ id: users.id, name: users.name, teamId: teamMembers.teamId })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(and(eq(teamMembers.tenantId, tenantId), inArray(teamMembers.teamId, [...teamIds]), eq(users.tenantId, tenantId), eq(users.banned, false)))
    .orderBy(asc(users.name), asc(teamMembers.teamId))
}

export async function assertMember(tx: Tx, { tenantId, userId, teamId }: { tenantId: string; userId: string; teamId: string }) {
  // FOR SHARE: desativar o usuário (UPDATE) espera esta transação, então ninguém é atribuído a quem está saindo.
  const [member] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, userId), activeMembersOf(tenantId, [teamId]))).for('share')
  if (!member) fail('Responsável não pertence à equipe')
}
