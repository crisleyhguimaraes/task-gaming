import { createServerFn } from '@tanstack/react-start'
import { and, asc, eq, inArray, ne } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '#/db'
import { taskDependencies, tasks } from '#/db/schema'
import { authMiddleware } from './auth-context'
import { canManage, fail } from './roles'
import { reaches } from './dependencies.core'

const pair = z.object({ taskId: z.uuid(), dependsOnTaskId: z.uuid() })

export const addDependency = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(pair)
  .handler(async ({ data, context: { auth: me } }) => {
    if (data.taskId === data.dependsOnTaskId) fail('Uma tarefa não depende de si mesma')
    const both = await db
      .select({ id: tasks.id, teamId: tasks.teamId })
      .from(tasks)
      .where(and(eq(tasks.tenantId, me.tenantId), inArray(tasks.id, [data.taskId, data.dependsOnTaskId])))
    if (both.length !== 2) fail('Tarefa não encontrada')
    const task = both.find((t) => t.id === data.taskId)!
    if (!canManage(me, task)) fail('Sem permissão')
    // ponytail: arestas do tenant em memória; CTE recursiva se crescer
    const edges = await db
      .select({ taskId: taskDependencies.taskId, dependsOnTaskId: taskDependencies.dependsOnTaskId })
      .from(taskDependencies)
      .where(eq(taskDependencies.tenantId, me.tenantId))
    if (reaches(edges, data.dependsOnTaskId, data.taskId)) fail('Dependência circular')
    await db.insert(taskDependencies).values({ tenantId: me.tenantId, ...data }).onConflictDoNothing()
  })

export const removeDependency = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(pair)
  .handler(async ({ data, context: { auth: me } }) => {
    const [task] = await db.select({ teamId: tasks.teamId }).from(tasks).where(and(eq(tasks.id, data.taskId), eq(tasks.tenantId, me.tenantId)))
    if (!task || !canManage(me, task)) fail('Sem permissão')
    await db
      .delete(taskDependencies)
      .where(and(eq(taskDependencies.tenantId, me.tenantId), eq(taskDependencies.taskId, data.taskId), eq(taskDependencies.dependsOnTaskId, data.dependsOnTaskId)))
  })

/** Dependências de uma tarefa + candidatas do mesmo time (para o editor). */
export const getDependencies = createServerFn()
  .middleware([authMiddleware])
  .validator(z.object({ taskId: z.uuid() }))
  .handler(async ({ data, context: { auth: me } }) => {
    const [task] = await db.select({ teamId: tasks.teamId }).from(tasks).where(and(eq(tasks.id, data.taskId), eq(tasks.tenantId, me.tenantId)))
    if (!task) fail('Tarefa não encontrada')
    const deps = await db
      .select({ id: tasks.id, title: tasks.title, status: tasks.status })
      .from(taskDependencies)
      .innerJoin(tasks, eq(tasks.id, taskDependencies.dependsOnTaskId))
      .where(eq(taskDependencies.taskId, data.taskId))
      .orderBy(asc(tasks.title))
    const candidates = await db
      .select({ id: tasks.id, title: tasks.title, status: tasks.status })
      .from(tasks)
      .where(and(eq(tasks.teamId, task.teamId), ne(tasks.id, data.taskId), ne(tasks.status, 'cancelled')))
      .orderBy(asc(tasks.title))
    return { deps, candidates: candidates.filter((c) => !deps.some((d) => d.id === c.id)), canManage: canManage(me, task) }
  })
