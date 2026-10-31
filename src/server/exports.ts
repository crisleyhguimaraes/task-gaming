import { createServerFn } from '@tanstack/react-start'
import { auditFilterSchema } from './audit-view'
import { authMiddleware } from './auth-context'
import { exportAuditCsvFor, exportTasksCsvFor } from './exports.core'
import { taskFilterSchema } from './tasks'

export const exportTasksCsv = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(taskFilterSchema.pick({ teamId: true, assigneeId: true, priority: true, search: true, boardId: true }))
  .handler(({ data, context: { auth: me } }) => exportTasksCsvFor(me, data))

export const exportAuditCsv = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(auditFilterSchema)
  .handler(({ data, context: { auth: me } }) =>
    exportAuditCsvFor(me, { ...data, from: data.from ? new Date(data.from) : undefined, to: data.to ? new Date(data.to) : undefined }),
  )
