import { eq } from 'drizzle-orm'
import { db } from '#/db'
import { teamMembers, teams, tenants, users } from '#/db/schema'
import type { TeamRole } from '#/lib/access'
import { auth } from '#/lib/auth'
import { loadAuthCtx } from './auth-context.core'
import { insertDefaultGoalAndRule } from './goals.core'
import { insertDefaultPipeline } from './pipelines.core'
import type { AuthCtx } from './roles'

type Team = { id: string }
type TenantRole = AuthCtx['role']

async function linkToTeam(tenantId: string, team: Team | null, role: TenantRole, userId: string, teamRole: TeamRole) {
  if (!team || role === 'SUPER_ADMIN') return
  await db.insert(teamMembers).values({ teamId: team.id, userId, tenantId, role: teamRole })
}

/** O contexto que o servidor montaria para a pessoa agora, lido do banco pelo mesmo carregador da sessão. */
export async function ctxFor(userId: string): Promise<AuthCtx> {
  const [user] = await db.select().from(users).where(eq(users.id, userId))
  return loadAuthCtx(user!, { impersonatedBy: null })
}

async function insertUser(tenantId: string, team: Team | null, role: TenantRole, id: string, name: string, teamRole: TeamRole = 'MEMBER'): Promise<AuthCtx> {
  await db.insert(users).values({ id, name, email: `${id}@test.local`, role, tenantId })
  await linkToTeam(tenantId, team, role, id, teamRole)
  return ctxFor(id)
}

/** Vínculo extra: é assim que a pessoa passa a ter mais de uma equipe. */
export async function joinTeam(f: { tenant: { id: string } }, userId: string, team: Team, role: TeamRole = 'MEMBER') {
  await db.insert(teamMembers).values({ teamId: team.id, userId, tenantId: f.tenant.id, role })
  return ctxFor(userId)
}

export function addAdmin(f: { tenant: { id: string; slug: string }; team: Team }) {
  return insertUser(f.tenant.id, f.team, 'TENANT_ADMIN', `adm-${f.tenant.slug}`, 'Admin')
}

export async function addTeam(f: { tenant: { id: string } }, name = `Equipe ${Math.random().toString(36).slice(2, 8)}`) {
  const [team] = await db.insert(teams).values({ tenantId: f.tenant.id, name }).returning()
  return team!
}

/** `team: null` cria quem não pertence a nenhuma equipe; `role` é o papel de tenant e `teamRole`, o papel na equipe. */
export function addUser(f: { tenant: { id: string } }, { role, team, teamRole }: { role: TenantRole; team: Team | null; teamRole?: TeamRole }) {
  const id = `u-${Math.random().toString(36).slice(2, 10)}`
  return insertUser(f.tenant.id, team, role, id, `User ${id}`, teamRole)
}

/** Usuário que entra de verdade pelo Better Auth, com o vínculo à equipe; o e-mail é `label-slug@test.local`. */
export async function addLoginUser(
  f: { tenant: { id: string; slug: string }; team: Team },
  { label, password, role = 'MEMBER', mustChangePassword = false }: { label: string; password: string; role?: 'MEMBER' | 'SUPER_ADMIN'; mustChangePassword?: boolean },
) {
  const email = `${label}-${f.tenant.slug}@test.local`
  const { user } = await auth.api.createUser({
    body: { name: label, email, password, role, data: { tenantId: f.tenant.id, mustChangePassword } },
  })
  await linkToTeam(f.tenant.id, f.team, role, user.id, 'MEMBER')
  return { id: user.id, email }
}

/** Tenant descartável com 1 time, 1 líder e N membros. Tudo cai em cascata no cleanup. */
export async function makeTenant(members = 2) {
  const suffix = Math.random().toString(36).slice(2, 8)
  const [tenant] = await db.insert(tenants).values({ name: `T ${suffix}`, slug: `t-${suffix}` }).returning()
  const pipeline = await insertDefaultPipeline(db, tenant!.id)
  const { goal, scoringRule } = await insertDefaultGoalAndRule(db, tenant!.id)
  const team = await addTeam({ tenant: tenant! }, 'Time')
  const mk = (i: number, teamRole: TeamRole) => insertUser(tenant!.id, team, 'MEMBER', `u-${suffix}-${i}`, `User ${i}`, teamRole)
  const leader = await mk(0, 'LEADER')
  const list: Array<AuthCtx> = []
  for (let i = 1; i <= members; i++) list.push(await mk(i, 'MEMBER'))
  return {
    tenant: tenant!,
    pipeline,
    goal,
    scoringRule,
    team,
    leader,
    members: list,
    cleanup: () => db.delete(tenants).where(eq(tenants.id, tenant!.id)),
  }
}
