import { eq } from 'drizzle-orm'
import { db } from './index'
import { tenants, users } from './schema'
import { auth } from '#/lib/auth'
import { insertDefaultGoalAndRule } from '#/server/goals.core'
import { insertDefaultPipeline } from '#/server/pipelines.core'

const email = process.env.SEED_SUPERADMIN_EMAIL!
const password = process.env.SEED_SUPERADMIN_PASSWORD!
const tenantName = process.env.SEED_ADMIN_TENANT_NAME ?? 'Administradora'

let tenant = (await db.select().from(tenants).where(eq(tenants.slug, 'admin')))[0]
if (!tenant) {
  tenant = await db.transaction(async (tx) => {
    const [created] = await tx.insert(tenants).values({ name: tenantName, slug: 'admin' }).returning()
    await insertDefaultPipeline(tx, created!.id)
    await insertDefaultGoalAndRule(tx, created!.id)
    return created!
  })
  console.log('tenant criado:', tenant.name)
}

const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email))
if (!existing) {
  await auth.api.createUser({
    body: { email, password, name: 'Super Admin', role: 'SUPER_ADMIN', data: { tenantId: tenant.id } },
  })
  console.log('super admin criado:', email)
}
console.log('seed ok')
process.exit(0)
