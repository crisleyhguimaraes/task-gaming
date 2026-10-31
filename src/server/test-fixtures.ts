import { eq } from 'drizzle-orm'
import { db } from '#/db'
import { teams, tenants, users } from '#/db/schema'
import { insertDefaultStages } from './stages.core'
import type { AuthCtx } from './roles'

type Team = { id: string }

async function insertUser(tenantId: string, team: Team | null, role: AuthCtx['role'], id: string, name: string): Promise<AuthCtx> {
  await db.insert(users).values({ id, name, email: `${id}@test.local`, role, tenantId, teamId: team?.id ?? null })
  return { userId: id, tenantId, teamId: team?.id ?? null, role, name, impersonatedBy: null, mustChangePassword: false }
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
