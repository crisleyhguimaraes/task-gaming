import { asc, eq } from 'drizzle-orm'
import { db } from '#/db'
import type { AuditChanges, AuditMeta } from '#/db/schema'
import { tasks, teams, users } from '#/db/schema'
import { auditActionLabels } from '#/lib/audit'
import type { CsvColumn } from '#/lib/csv'
import { toCsv } from '#/lib/csv'
import { listAuditEventsFor, recordAudit } from './audit.core'
import type { AuditFilters } from './audit.core'
import type { AuthCtx } from './roles'
import { fail, requireCan } from './roles'
import type { TaskListFilters } from './tasks.core'
import { taskListWhere } from './tasks.core'

export type CsvFile = { filename: string; content: string }

export const EXPORT_ROW_LIMIT = 20_000
const AUDIT_PAGE_SIZE = 200

const actionLabels: Record<string, string> = auditActionLabels
const statusLabels = { pending: 'A fazer', in_progress: 'Em andamento', paused: 'Pausada', finished: 'Concluída', cancelled: 'Cancelada' }
const priorityLabels = { low: 'Baixa', medium: 'Média', high: 'Alta', urgent: 'Urgente' }

const minutes = (seconds: number | null) => (seconds === null ? null : Math.round(seconds / 60))

const describeChanges = (changes: AuditChanges | null) =>
  changes ? Object.entries(changes).map(([field, { from, to }]) => `${field}: ${from} → ${to}`).join('; ') : ''

const describeMeta = (meta: AuditMeta | null) => (meta ? Object.entries(meta).map(([key, value]) => `${key}=${value}`).join('; ') : '')

type TaskRow = { task: typeof tasks.$inferSelect; assigneeName: string | null; teamName: string }

const taskColumns: Array<CsvColumn<TaskRow>> = [
  { header: 'Título', value: (r) => r.task.title },
  { header: 'Descrição', value: (r) => r.task.description },
  { header: 'Equipe', value: (r) => r.teamName },
  { header: 'Responsável', value: (r) => r.assigneeName },
  { header: 'Status', value: (r) => statusLabels[r.task.status] },
  { header: 'Prioridade', value: (r) => priorityLabels[r.task.priority] },
  { header: 'Pontos base', value: (r) => r.task.basePoints },
  { header: 'Pontos concedidos', value: (r) => r.task.awardedPoints },
  { header: 'Estimativa (min)', value: (r) => minutes(r.task.estimatedSeconds) },
  { header: 'Tempo em movimento (min)', value: (r) => minutes(r.task.movingSeconds) },
  { header: 'Prazo', value: (r) => r.task.dueDate },
  { header: 'Criada em', value: (r) => r.task.createdAt },
  { header: 'Concluída em', value: (r) => r.task.finishedAt },
]

type AuditRow = Awaited<ReturnType<typeof listAuditEventsFor>>['events'][number]

const auditColumns: Array<CsvColumn<AuditRow>> = [
  { header: 'Data', value: (e) => e.createdAt },
  { header: 'Ação', value: (e) => actionLabels[e.action] ?? e.action },
  { header: 'Ator', value: (e) => e.actorName },
  { header: 'Impersonado por (id)', value: (e) => e.impersonatedBy },
  { header: 'Entidade', value: (e) => e.entityType },
  { header: 'ID da entidade', value: (e) => e.entityId },
  { header: 'Alterações', value: (e) => describeChanges(e.changes) },
  { header: 'Detalhes', value: (e) => describeMeta(e.meta) },
]

const filenameFor = (prefix: string) => `${prefix}-${new Date().toISOString().slice(0, 10)}.csv`

function assertWithinLimit(rows: number, rowLimit: number) {
  if (rows > rowLimit) fail(`A exportação passa do limite de ${rowLimit} linhas; refine os filtros`)
}

async function recordExport(me: AuthCtx, kind: 'tasks' | 'audit', rows: number) {
  await recordAudit(db, me, { action: 'export.created', entityType: 'export', entityId: kind, meta: { kind, rows } })
}

export async function exportTasksCsvFor(me: AuthCtx, filters: TaskListFilters, rowLimit = EXPORT_ROW_LIMIT): Promise<CsvFile> {
  requireCan(me, 'export.csv')
  const rows = await db
    .select({ task: tasks, assigneeName: users.name, teamName: teams.name })
    .from(tasks)
    .leftJoin(users, eq(users.id, tasks.assignedToId))
    .innerJoin(teams, eq(teams.id, tasks.teamId))
    .where(taskListWhere(me, filters))
    .orderBy(asc(tasks.createdAt), asc(tasks.id))
    .limit(rowLimit + 1)
  assertWithinLimit(rows.length, rowLimit)
  await recordExport(me, 'tasks', rows.length)
  return { filename: filenameFor('tarefas'), content: toCsv(rows, taskColumns) }
}

// NOTE: reaproveita a paginação de listAuditEventsFor (200 por vez, até 100 consultas no teto); se exportar virar rotina, extrair o where para uma consulta única.
async function allAuditEvents(me: AuthCtx, filters: AuditFilters, rowLimit: number) {
  const events: Array<AuditRow> = []
  let cursor: string | undefined
  do {
    const page = await listAuditEventsFor(me, { ...filters, cursor, limit: AUDIT_PAGE_SIZE })
    events.push(...page.events)
    assertWithinLimit(events.length, rowLimit)
    cursor = page.nextCursor ?? undefined
  } while (cursor)
  return events
}

export async function exportAuditCsvFor(me: AuthCtx, filters: Omit<AuditFilters, 'cursor' | 'limit'>, rowLimit = EXPORT_ROW_LIMIT): Promise<CsvFile> {
  requireCan(me, 'export.csv')
  requireCan(me, 'audit.read')
  const events = await allAuditEvents(me, filters, rowLimit)
  await recordExport(me, 'audit', events.length)
  return { filename: filenameFor('auditoria'), content: toCsv(events, auditColumns) }
}
