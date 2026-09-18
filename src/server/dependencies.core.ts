import { and, eq, inArray, ne } from 'drizzle-orm'
import { db } from '#/db'
import { taskDependencies, tasks } from '#/db/schema'

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
