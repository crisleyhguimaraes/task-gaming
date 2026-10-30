import { and, asc, eq, inArray, ne } from 'drizzle-orm'
import { db } from '#/db'
import { taskDependencies, tasks } from '#/db/schema'
import { recordAudit } from './audit.core'
import type { AuthCtx } from './roles'
import { canManage, canSee, fail } from './roles'

/** true se, seguindo "depends_on" a partir de `from`, chegamos em `target`. */
export function reaches(edges: Array<{ taskId: string; dependsOnTaskId: string }>, from: string, target: string) {
  const next = new Map<string, Array<string>>()
  for (const e of edges) (next.get(e.taskId) ?? next.set(e.taskId, []).get(e.taskId)!).push(e.dependsOnTaskId)
  const seen = new Set<string>()
  const stack = [from]
  while (stack.length) {
    const cur = stack.pop()!
    if (cur === target) return true
    if (seen.has(cur)) continue
    seen.add(cur)
    stack.push(...(next.get(cur) ?? []))
  }
  return false
}

/** ids de tarefas bloqueadas (têm dependência não concluída) dentro de `taskIds`. */
export async function blockedSet(taskIds: Array<string>) {
  if (taskIds.length === 0) return new Set<string>()
  const rows = await db
    .select({ taskId: taskDependencies.taskId })
    .from(taskDependencies)
    .innerJoin(tasks, eq(tasks.id, taskDependencies.dependsOnTaskId))
    .where(and(inArray(taskDependencies.taskId, taskIds), ne(tasks.status, 'finished')))
  return new Set(rows.map((r) => r.taskId))
}

export const isBlocked = async (taskId: string) => (await blockedSet([taskId])).has(taskId)

export async function addDependencyFor(me: AuthCtx, data: { taskId: string; dependsOnTaskId: string }) {
  if (data.taskId === data.dependsOnTaskId) fail('Uma tarefa não depende de si mesma')
  const both = await db
    .select({ id: tasks.id, teamId: tasks.teamId })
    .from(tasks)
    .where(and(eq(tasks.tenantId, me.tenantId), inArray(tasks.id, [data.taskId, data.dependsOnTaskId])))
  if (both.length !== 2) fail('Tarefa não encontrada')
  const [task, dependsOn] = [data.taskId, data.dependsOnTaskId].map((id) => both.find((t) => t.id === id)!)
  if (!canManage(me, task!)) fail('Sem permissão')
  if (task!.teamId !== dependsOn!.teamId) fail('Dependência só entre tarefas da mesma equipe')
  // NOTE: arestas do tenant em memória; CTE recursiva se crescer
  const edges = await db
    .select({ taskId: taskDependencies.taskId, dependsOnTaskId: taskDependencies.dependsOnTaskId })
    .from(taskDependencies)
    .where(eq(taskDependencies.tenantId, me.tenantId))
  if (reaches(edges, data.dependsOnTaskId, data.taskId)) fail('Dependência circular')
  await db.transaction(async (tx) => {
    const inserted = await tx.insert(taskDependencies).values({ tenantId: me.tenantId, ...data }).onConflictDoNothing().returning({ id: taskDependencies.id })
    if (inserted.length) {
      await recordAudit(tx, me, { action: 'dependency.added', entityType: 'task', entityId: data.taskId, meta: { dependsOnTaskId: data.dependsOnTaskId } })
    }
  })
}

export async function removeDependencyFor(me: AuthCtx, data: { taskId: string; dependsOnTaskId: string }) {
  const [task] = await db.select({ teamId: tasks.teamId }).from(tasks).where(and(eq(tasks.id, data.taskId), eq(tasks.tenantId, me.tenantId)))
  if (!task || !canManage(me, task)) fail('Sem permissão')
  await db.transaction(async (tx) => {
    const removed = await tx
      .delete(taskDependencies)
      .where(and(eq(taskDependencies.tenantId, me.tenantId), eq(taskDependencies.taskId, data.taskId), eq(taskDependencies.dependsOnTaskId, data.dependsOnTaskId)))
      .returning({ id: taskDependencies.id })
    if (removed.length) {
      await recordAudit(tx, me, { action: 'dependency.removed', entityType: 'task', entityId: data.taskId, meta: { dependsOnTaskId: data.dependsOnTaskId } })
    }
  })
}

/** Dependências de uma tarefa + candidatas do mesmo time (para o editor). */
export async function getDependenciesFor(me: AuthCtx, taskId: string) {
  const [task] = await db
    .select({ teamId: tasks.teamId, assignedToId: tasks.assignedToId })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.tenantId, me.tenantId)))
  if (!task || !canSee(me, task)) fail('Tarefa não encontrada')
  const deps = await db
    .select({ id: tasks.id, title: tasks.title, status: tasks.status })
    .from(taskDependencies)
    .innerJoin(tasks, eq(tasks.id, taskDependencies.dependsOnTaskId))
    .where(eq(taskDependencies.taskId, taskId))
    .orderBy(asc(tasks.title))
  const candidates = await db
    .select({ id: tasks.id, title: tasks.title, status: tasks.status })
    .from(tasks)
    .where(and(eq(tasks.teamId, task.teamId), ne(tasks.id, taskId), ne(tasks.status, 'cancelled')))
    .orderBy(asc(tasks.title))
  return { deps, candidates: candidates.filter((c) => !deps.some((d) => d.id === c.id)), canManage: canManage(me, task) }
}
