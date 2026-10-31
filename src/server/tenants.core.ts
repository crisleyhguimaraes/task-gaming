import { asc, eq } from 'drizzle-orm'
import { db } from '#/db'
import { teamMembers, teams, tenants, users } from '#/db/schema'
import { auth } from '#/lib/auth'
import { recordAudit } from './audit.core'
import type { AuthCtx } from './roles'
import { insertDefaultStages } from './stages.core'

export async function createTenantFor(me: AuthCtx, data: { name: string; slug: string; timezone: string }) {
  return db.transaction(async (tx) => {
    const [tenant] = await tx.insert(tenants).values(data).returning()
    await insertDefaultStages(tx, tenant!.id)
    await recordAudit(tx, me, {
      action: 'tenant.created',
      entityType: 'tenant',
      entityId: tenant!.id,
      tenantId: tenant!.id,
      meta: { name: data.name, slug: data.slug },
    })
    return tenant!
  })
}

export async function createTenantAdminFor(me: AuthCtx, data: { tenantId: string; name: string; email: string; password: string }) {
  const { user } = await auth.api.createUser({
    body: {
      name: data.name,
      email: data.email,
      password: data.password,
      role: 'TENANT_ADMIN',
      data: { tenantId: data.tenantId, mustChangePassword: true },
    },
  })
  await recordAudit(db, me, { action: 'tenant.admin_created', entityType: 'user', entityId: user.id, tenantId: data.tenantId, meta: { email: data.email } })
  return user
}

/** Todas as pessoas do tenant, cada uma com os nomes das equipes dela (a tela do super admin). */
export async function tenantMembersOf(tenantId: string) {
  const people = await db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role })
    .from(users)
    .where(eq(users.tenantId, tenantId))
    .orderBy(asc(users.name))
  const links = await db
    .select({ userId: teamMembers.userId, teamName: teams.name })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(eq(teamMembers.tenantId, tenantId))
    .orderBy(asc(teams.name))
  return people.map((p) => ({ ...p, teams: links.filter((l) => l.userId === p.id).map((l) => l.teamName) }))
}
