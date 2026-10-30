import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '#/db'
import type { AuditMeta } from '#/db/schema'
import { notifications } from '#/db/schema'
import type { NotificationType } from '#/lib/notifications'
import type { AuthCtx } from './roles'

type Actor = Pick<AuthCtx, 'userId' | 'tenantId'>

export type NewNotification = {
  userIds: Array<string | null>
  type: NotificationType
  entityType: string
  entityId: string
  payload?: AuditMeta
}

/** Chamar dentro da mesma transação do fato notificado. O autor nunca é avisado do que ele mesmo fez. */
export async function notify(tx: Pick<typeof db, 'insert'>, actor: Actor, { userIds, ...notification }: NewNotification) {
  const recipients = [...new Set(userIds)].filter((id): id is string => id !== null && id !== actor.userId)
  if (recipients.length === 0) return
  await tx.insert(notifications).values(recipients.map((userId) => ({ tenantId: actor.tenantId, userId, ...notification })))
}

const mine = (me: Actor) => and(eq(notifications.tenantId, me.tenantId), eq(notifications.userId, me.userId))

const DEFAULT_LIST_SIZE = 20

export function listMyNotificationsFor(me: Actor, limit = DEFAULT_LIST_SIZE) {
  return db.select().from(notifications).where(mine(me)).orderBy(desc(notifications.createdAt), desc(notifications.id)).limit(limit)
}

export async function countUnreadFor(me: Actor) {
  const [row] = await db
    .select({ unread: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(mine(me), isNull(notifications.readAt)))
  return row!.unread
}

export async function markReadFor(me: Actor, notificationId: string) {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(mine(me), eq(notifications.id, notificationId), isNull(notifications.readAt)))
}

export async function markAllReadFor(me: Actor) {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(mine(me), isNull(notifications.readAt)))
}
