import { createServerFn } from '@tanstack/react-start'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '#/db'
import { taskDependencies, tasks } from '#/db/schema'
import { authMiddleware } from './auth-context'
import { canManage, fail } from './roles'
import { addDependencyFor, getDependenciesFor } from './dependencies.core'

const pair = z.object({ taskId: z.uuid(), dependsOnTaskId: z.uuid() })

export const addDependency = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(pair)
  .handler(({ data, context: { auth: me } }) => addDependencyFor(me, data))

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

export const getDependencies = createServerFn()
  .middleware([authMiddleware])
  .validator(z.object({ taskId: z.uuid() }))
  .handler(({ data, context: { auth: me } }) => getDependenciesFor(me, data.taskId))
