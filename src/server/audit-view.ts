import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { auditActions } from '#/lib/audit'
import { auditActorsFor, listAuditPageFor } from './audit-view.core'
import { authMiddleware } from './auth-context'

export const auditFilterSchema = z.object({
  actorId: z.string().optional(),
  action: z.enum(auditActions).optional(),
  entityType: z.string().max(40).optional(),
  entityId: z.string().max(80).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
})

export const listAuditPage = createServerFn()
  .middleware([authMiddleware])
  .validator(auditFilterSchema.extend({ cursor: z.uuid().optional() }))
  .handler(({ data, context: { auth: me } }) =>
    listAuditPageFor(me, { ...data, from: data.from ? new Date(data.from) : undefined, to: data.to ? new Date(data.to) : undefined }),
  )

export const getAuditActors = createServerFn()
  .middleware([authMiddleware])
  .handler(({ context: { auth: me } }) => auditActorsFor(me))
