import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { auditActions } from '#/lib/audit'
import { listAuditEventsFor, taskHistoryFor } from './audit.core'
import { authMiddleware, requireRole } from './auth-context'

export const listAuditEvents = createServerFn()
  .middleware([authMiddleware])
  .validator(
    z.object({
      actorId: z.string().optional(),
      action: z.enum(auditActions).optional(),
      entityType: z.string().max(40).optional(),
      entityId: z.string().max(80).optional(),
      from: z.iso.datetime().optional(),
      to: z.iso.datetime().optional(),
      cursor: z.uuid().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    }),
  )
  .handler(({ data, context: { auth: me } }) => {
    requireRole(me, 'SUPER_ADMIN', 'TENANT_ADMIN')
    return listAuditEventsFor(me, { ...data, from: data.from ? new Date(data.from) : undefined, to: data.to ? new Date(data.to) : undefined })
  })

export const getTaskHistory = createServerFn()
  .middleware([authMiddleware])
  .validator(z.object({ taskId: z.uuid() }))
  .handler(({ data, context: { auth: me } }) => taskHistoryFor(me, data.taskId))
