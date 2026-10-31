import { and, eq, inArray } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'
import type { Role } from '#/db/schema'
import { users } from '#/db/schema'
import type { AuthCtx } from './roles'
import { fail, forbid, isAdmin } from './roles'
import type { Tx } from './tx'

/** `'all'` é o tenant inteiro (admin); do contrário, só as equipes da lista. */
export function teamIdsOf(me: AuthCtx): 'all' | ReadonlyArray<string> {
  if (isAdmin(me)) return 'all'
  return me.teamId ? [me.teamId] : []
}

/** Filtro de equipe pela visibilidade de `me`; admin não ganha filtro. `only` restringe a uma equipe, e equipe alheia dá vazio. */
export function inTeams(column: PgColumn, me: AuthCtx, { only }: { only?: string } = {}) {
  const ids = teamIdsOf(me)
  if (ids === 'all') return only ? eq(column, only) : undefined
  return inArray(column, ids.filter((id) => !only || id === only))
}

/** Admin continua preso ao próprio tenant: nunca use `inTeams` sozinho numa tabela de vários tenants. */
export function inTenantTeams(table: { tenantId: PgColumn; teamId: PgColumn }, me: AuthCtx, options?: { only?: string }) {
  return and(eq(table.tenantId, me.tenantId), inTeams(table.teamId, me, options))
}

/** Quem não é admin só age sobre membro comum de equipe própria. Sem equipe não há escopo: `null === null` não conta. */
export function assertWithinScope(me: AuthCtx, target: { role: Role; teamId: string | null }) {
  const ids = teamIdsOf(me)
  if (ids === 'all') return
  if (target.role !== 'MEMBER' || target.teamId === null || !ids.includes(target.teamId)) forbid()
}

/** Regra única de "responsável ativo": membro da equipe, do tenant, e não desativado. */
export const activeMembersOf = (tenantId: string, teamIds: ReadonlyArray<string>) =>
  and(eq(users.tenantId, tenantId), inArray(users.teamId, [...teamIds]), eq(users.banned, false))

export async function assertMember(tx: Tx, { tenantId, userId, teamId }: { tenantId: string; userId: string; teamId: string }) {
  // FOR SHARE: desativar o usuário (UPDATE) espera esta transação, então ninguém é atribuído a quem está saindo.
  const [member] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, userId), activeMembersOf(tenantId, [teamId]))).for('share')
  if (!member) fail('Responsável não pertence à equipe')
}
