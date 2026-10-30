import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { authMiddleware } from './auth-context'
import { addDependencyFor, getDependenciesFor, removeDependencyFor } from './dependencies.core'

const pair = z.object({ taskId: z.uuid(), dependsOnTaskId: z.uuid() })

export const addDependency = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(pair)
  .handler(({ data, context: { auth: me } }) => addDependencyFor(me, data))

export const removeDependency = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(pair)
  .handler(({ data, context: { auth: me } }) => removeDependencyFor(me, data))

export const getDependencies = createServerFn()
  .middleware([authMiddleware])
  .validator(z.object({ taskId: z.uuid() }))
  .handler(({ data, context: { auth: me } }) => getDependenciesFor(me, data.taskId))
