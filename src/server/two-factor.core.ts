import { eq } from 'drizzle-orm'
import { db } from '#/db'
import { tenants, users } from '#/db/schema'
import type { AuthCtx } from './roles'

/** Quem está impersonando não tem o autenticador do alvo, então não pode ser barrado pela exigência do tenant. */
export async function twoFactorStatusFor(me: Pick<AuthCtx, 'userId' | 'impersonatedBy'>) {
  const [row] = await db
    .select({ enabled: users.twoFactorEnabled, required: tenants.requireTwoFactor })
    .from(users)
    .innerJoin(tenants, eq(tenants.id, users.tenantId))
    .where(eq(users.id, me.userId))
  const enabled = row?.enabled ?? false
  const required = row?.required ?? false
  return { enabled, required, setupPending: required && !enabled && !me.impersonatedBy }
}
