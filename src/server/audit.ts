import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { taskHistoryFor } from './audit.core'
import { authMiddleware } from './auth-context'

export const getTaskHistory = createServerFn()
  .middleware([authMiddleware])
  .validator(z.object({ taskId: z.uuid() }))
  .handler(({ data, context: { auth: me } }) => taskHistoryFor(me, data.taskId))
