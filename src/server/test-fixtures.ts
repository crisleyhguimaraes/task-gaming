import { eq } from 'drizzle-orm'
import { db } from '#/db'
import { teamMembers, teams, tenants, users } from '#/db/schema'
import type { TeamRole } from '#/lib/access'
import { auth } from '#/lib/auth'
import { loadAuthCtx } from './auth-context.core'
import { insertDefaultStages } from './stages.core'
import type { AuthCtx } from './roles'
import { teamRoleOf } from './team-members.core'

type Team = { id: string }

async function linkToTeam(tenantId: string, team: Team | null, role: AuthCtx['role'], userId: string) {
  if (!team || role === 'SUPER_ADMIN') return
  await db.insert(teamMembers).values({ teamId: team.id, userId, tenantId, role: teamRoleOf(role) })
}

/** O contexto que o servidor montaria para a pessoa agora, lido do banco pelo mesmo carregador da sessão. */
export async function ctxFor(userId: string): Promise<AuthCtx> {
  const [user] = await db.select().from(users).where(eq(users.id, userId))
  return loadAuthCtx(user!, { impersonatedBy: null })
}

async function insertUser(tenantId: string, team: Team | null, role: AuthCtx['role'], id: string, name: string): Promise<AuthCtx> {
  await db.insert(users).values({ id, name, email: `${id}@test.local`, role, tenantId, teamId: team?.id ?? null })
  await linkToTeam(tenantId, team, role, id)
  return ctxFor(id)
}

/** Vínculo extra, fora do dual-write: é assim que a pessoa passa a ter mais de uma equipe. */
export async function joinTeam(f: { tenant: { id: string } }, userId: string, team: Team, role: TeamRole = 'MEMBER') {
  await db.insert(teamMembers).values({ teamId: team.id, userId, tenantId: f.tenant.id, role })
  return ctxFor(userId)
}

export function addAdmin(f: { tenant: { id: string; slug: string }; team: Team }) {
  return insertUser(f.tenant.id, f.team, 'TENANT_ADMIN', `adm-${f.tenant.slug}`, 'Admin')
}

export async function addTeam(f: { tenant: { id: string } }, name = 'Outra equipe') {
  const [team] = await db.insert(teams).values({ tenantId: f.tenant.id, name }).returning()
  return team!
}

/** `team: null` cria quem não pertence a nenhuma equipe. */
export function addUser(f: { tenant: { id: string } }, { role, team }: { role: AuthCtx['role']; team: Team | null }) {
  const id = `u-${Math.random().toString(36).slice(2, 10)}`
  return insertUser(f.tenant.id, team, role, id, `User ${id}`)
}

/** Usuário que entra de verdade pelo Better Auth, com o vínculo à equipe; o e-mail é `label-slug@test.local`. */
export async function addLoginUser(
  f: { tenant: { id: string; slug: string }; team: Team },
  { label, password, role = 'MEMBER', mustChangePassword = false }: { label: string; password: string; role?: 'MEMBER' | 'SUPER_ADMIN'; mustChangePassword?: boolean },
) {
  const email = `${label}-${f.tenant.slug}@test.local`
  const { user } = await auth.api.createUser({
    body: { name: label, email, password, role, data: { tenantId: f.tenant.id, teamId: f.team.id, mustChangePassword } },
  })
  await linkToTeam(f.tenant.id, f.team, role, user.id)
  return { id: user.id, email }
}

/** Tenant descartável com 1 time, 1 líder e N membros. Tudo cai em cascata no cleanup. */
export async function makeTenant(members = 2) {
  const suffix = Math.random().toString(36).slice(2, 8)
  const [tenant] = await db.insert(tenants).values({ name: `T ${suffix}`, slug: `t-${suffix}` }).returning()
  await insertDefaultStages(db, tenant!.id)
  const team = await addTeam({ tenant: tenant! }, 'Time')
  const mk = (role: AuthCtx['role'], i: number) => insertUser(tenant!.id, team, role, `u-${suffix}-${i}`, `User ${i}`)
  const leader = await mk('TEAM_LEADER', 0)
  const list: Array<AuthCtx> = []
  for (let i = 1; i <= members; i++) list.push(await mk('MEMBER', i))
  return {
    tenant: tenant!,
    team,
    leader,
    members: list,
    cleanup: () => db.delete(tenants).where(eq(tenants.id, tenant!.id)),
  }
}
