import { asc, eq, inArray } from 'drizzle-orm'
import { db } from '#/db'
import { users } from '#/db/schema'
import type { AuditFilters } from './audit.core'
import { listAuditEventsFor } from './audit.core'
import type { AuthCtx } from './roles'
import { requireCan } from './roles'

/** Página de auditoria com o nome de quem impersonou; o evento guarda só o id. */
export async function listAuditPageFor(me: AuthCtx, filters: AuditFilters) {
  requireCan(me, 'audit.read')
  const page = await listAuditEventsFor(me, filters)
  const impersonatorIds = [...new Set(page.events.flatMap((e) => (e.impersonatedBy ? [e.impersonatedBy] : [])))]
  const impersonators = impersonatorIds.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, impersonatorIds)) : []
  const nameById = new Map(impersonators.map((u) => [u.id, u.name]))
  return {
    nextCursor: page.nextCursor,
    events: page.events.map((e) => ({ ...e, impersonatorName: (e.impersonatedBy && nameById.get(e.impersonatedBy)) || null })),
  }
}

export async function auditActorsFor(me: AuthCtx) {
  requireCan(me, 'audit.read')
  return db.select({ id: users.id, name: users.name }).from(users).where(eq(users.tenantId, me.tenantId)).orderBy(asc(users.name))
}
