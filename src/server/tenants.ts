import { createServerFn } from '@tanstack/react-start'
import { asc, count, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '#/db'
import { teams, tenants, users } from '#/db/schema'
import { authMiddleware, requireCan } from './auth-context'
import { createTenantAdminFor, createTenantFor } from './tenants.core'

export const listTenants = createServerFn()
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    requireCan(context.auth, 'tenant.manage')
    return db
      .select({
        id: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
        timezone: tenants.timezone,
        userCount: count(users.id),
      })
      .from(tenants)
      .leftJoin(users, eq(users.tenantId, tenants.id))
      .groupBy(tenants.id)
      .orderBy(asc(tenants.name))
  })

export const createTenant = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(
    z.object({
      name: z.string().trim().min(2).max(120),
      slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,60}$/),
      timezone: z.string().trim().min(3).max(64),
    }),
  )
  .handler(({ data, context }) => {
    requireCan(context.auth, 'tenant.manage')
    return createTenantFor(context.auth, data)
  })

export const getTenant = createServerFn()
  .middleware([authMiddleware])
  .validator(z.object({ tenantId: z.uuid() }))
  .handler(async ({ data, context }) => {
    requireCan(context.auth, 'tenant.manage')
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, data.tenantId))
    if (!tenant) throw new Error('Tenant não encontrado')
    const members = await db
      .select({ id: users.id, name: users.name, email: users.email, role: users.role, teamName: teams.name })
      .from(users)
      .leftJoin(teams, eq(teams.id, users.teamId))
      .where(eq(users.tenantId, data.tenantId))
      .orderBy(asc(users.name))
    return { tenant, members }
  })

export const createTenantAdmin = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(
    z.object({
      tenantId: z.uuid(),
      name: z.string().trim().min(2).max(120),
      email: z.email(),
      password: z.string().min(8),
    }),
  )
  .handler(async ({ data, context }) => {
    requireCan(context.auth, 'tenant.manage')
    await createTenantAdminFor(context.auth, data)
  })
