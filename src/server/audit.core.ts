import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm'
import { db } from '#/db'
import type { AuditChanges, AuditMeta } from '#/db/schema'
import { auditEvents, tasks } from '#/db/schema'
import type { AuditAction } from '#/lib/audit'
import type { AuthCtx } from './roles'
import { canManage, fail, forbid } from './roles'

export type Actor = Pick<AuthCtx, 'userId' | 'tenantId' | 'name' | 'impersonatedBy'>

export type AuditEvent = {
  action: AuditAction
  entityType: string
  entityId: string
  /** Quando o evento pertence a outro tenant que não o do ator (ex.: SUPER_ADMIN criando tenant). */
  tenantId?: string
  changes?: AuditChanges
  meta?: AuditMeta
}

/** Chamar dentro da mesma transação da mudança auditada: sem o registro, a mudança também não vale. */
export async function recordAudit(tx: Pick<typeof db, 'insert'>, actor: Actor, event: AuditEvent) {
  const hasChanges = event.changes && Object.keys(event.changes).length > 0
  await tx.insert(auditEvents).values({
    tenantId: event.tenantId ?? actor.tenantId,
    actorId: actor.userId,
    actorName: actor.name,
    impersonatedBy: actor.impersonatedBy,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    changes: hasChanges ? event.changes : null,
    meta: event.meta ?? null,
  })
}

export type AuditFilters = {
  actorId?: string
  action?: AuditAction
  entityType?: string
  entityId?: string
  from?: Date
  to?: Date
  cursor?: string
  limit?: number
}

const DEFAULT_PAGE = 50
const MAX_PAGE = 200

export async function listAuditEventsFor(me: AuthCtx, filters: AuditFilters) {
  const limit = Math.min(filters.limit ?? DEFAULT_PAGE, MAX_PAGE)
  // Cursor é o id da última linha: a posição vem do banco, com precisão de microssegundos que o Date do JS perde.
  const afterCursor = filters.cursor
    ? sql`(${auditEvents.createdAt}, ${auditEvents.id}) < (select a.created_at, a.id from audit_events a where a.id = ${filters.cursor} and a.tenant_id = ${me.tenantId})`
    : undefined
  const rows = await db
    .select()
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.tenantId, me.tenantId),
        filters.actorId ? eq(auditEvents.actorId, filters.actorId) : undefined,
        filters.action ? eq(auditEvents.action, filters.action) : undefined,
        filters.entityType ? eq(auditEvents.entityType, filters.entityType) : undefined,
        filters.entityId ? eq(auditEvents.entityId, filters.entityId) : undefined,
        filters.from ? gte(auditEvents.createdAt, filters.from) : undefined,
        filters.to ? lte(auditEvents.createdAt, filters.to) : undefined,
        afterCursor,
      ),
    )
    .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
    .limit(limit + 1)
  const events = rows.slice(0, limit)
  return { events, nextCursor: rows.length > limit ? events[events.length - 1]!.id : null }
}

export async function taskHistoryFor(me: AuthCtx, taskId: string) {
  const [task] = await db.select({ teamId: tasks.teamId }).from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.tenantId, me.tenantId)))
  if (!task) fail('Tarefa não encontrada')
  if (!canManage(me, task)) forbid()
  return db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.tenantId, me.tenantId), eq(auditEvents.entityType, 'task'), eq(auditEvents.entityId, taskId)))
    .orderBy(asc(auditEvents.createdAt), asc(auditEvents.id))
}
