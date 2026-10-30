import { db } from '#/db'
import { tenants } from '#/db/schema'
import { auth } from '#/lib/auth'
import { recordAudit } from './audit.core'
import type { AuthCtx } from './roles'

export async function createTenantFor(me: AuthCtx, data: { name: string; slug: string; timezone: string }) {
  return db.transaction(async (tx) => {
    const [tenant] = await tx.insert(tenants).values(data).returning()
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
