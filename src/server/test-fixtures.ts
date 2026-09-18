import { eq } from 'drizzle-orm'
import { db } from '#/db'
import { teams, tenants, users } from '#/db/schema'
import type { AuthCtx } from './roles'

/** Tenant descartável com 1 time, 1 líder e N membros. Tudo cai em cascata no cleanup. */
export async function makeTenant(members = 2) {
  const suffix = Math.random().toString(36).slice(2, 8)
  const [tenant] = await db.insert(tenants).values({ name: `T ${suffix}`, slug: `t-${suffix}` }).returning()
  const [team] = await db.insert(teams).values({ tenantId: tenant!.id, name: 'Time' }).returning()
  const mk = async (role: AuthCtx['role'], i: number): Promise<AuthCtx> => {
    const id = `u-${suffix}-${i}`
    await db.insert(users).values({ id, name: `User ${i}`, email: `${id}@test.local`, role, tenantId: tenant!.id, teamId: team!.id })
    return { userId: id, tenantId: tenant!.id, teamId: team!.id, role, name: `User ${i}`, impersonatedBy: null, mustChangePassword: false }
  }
  const leader = await mk('TEAM_LEADER', 0)
  const list: Array<AuthCtx> = []
  for (let i = 1; i <= members; i++) list.push(await mk('MEMBER', i))
  return {
    tenant: tenant!,
    team: team!,
    leader,
    members: list,
    cleanup: () => db.delete(tenants).where(eq(tenants.id, tenant!.id)),
  }
}
