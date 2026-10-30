import { db } from '#/db'
import type { AuditMeta } from '#/db/schema'
import { recordAudit } from './audit.core'
import type { AuthCtx } from './roles'
import { ForbiddenError } from './roles'

/** Fora do authMiddleware para ser testável sem HTTP; o middleware só liga este wrapper ao `next()`. */
export async function auditDenials<T>(me: AuthCtx, meta: AuditMeta, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof ForbiddenError) {
      await recordAudit(db, me, { action: 'access.denied', entityType: 'user', entityId: me.userId, meta })
    }
    throw error
  }
}
