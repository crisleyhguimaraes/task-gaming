import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { authMiddleware } from './auth-context'
import { countUnreadFor, listMyNotificationsFor, markAllReadFor, markReadFor } from './notifications.core'

export const getNotifications = createServerFn()
  .middleware([authMiddleware])
  .handler(async ({ context: { auth: me } }) => ({
    unread: await countUnreadFor(me),
    items: await listMyNotificationsFor(me),
  }))

export const markNotificationRead = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid() }))
  .handler(({ data, context: { auth: me } }) => markReadFor(me, data.id))

export const markAllNotificationsRead = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .handler(({ context: { auth: me } }) => markAllReadFor(me))
