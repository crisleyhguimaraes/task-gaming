import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { authMiddleware } from './auth-context'
import { archivePipelineFor, createPipelineFor, linkTeamToPipelineFor, listPipelinesFor, renamePipelineFor, restorePipelineFor, unlinkTeamFromPipelineFor } from './pipelines.core'

const pipelineName = z.string().trim().min(2).max(80)
const pipelineId = z.object({ pipelineId: z.uuid() })
const teamLink = z.object({ pipelineId: z.uuid(), teamId: z.uuid() })

export const listPipelines = createServerFn()
  .middleware([authMiddleware])
  .handler(({ context: { auth: me } }) => listPipelinesFor(me))

export const createPipeline = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ name: pipelineName }))
  .handler(async ({ data, context: { auth: me } }) => {
    const pipeline = await createPipelineFor(me, data.name)
    return { id: pipeline.id }
  })

export const renamePipeline = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ pipelineId: z.uuid(), name: pipelineName }))
  .handler(async ({ data, context: { auth: me } }) => {
    await renamePipelineFor(me, data.pipelineId, data.name)
  })

export const archivePipeline = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(pipelineId)
  .handler(({ data, context: { auth: me } }) => archivePipelineFor(me, data.pipelineId))

export const restorePipeline = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(pipelineId)
  .handler(({ data, context: { auth: me } }) => restorePipelineFor(me, data.pipelineId))

export const linkTeamToPipeline = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(teamLink)
  .handler(({ data, context: { auth: me } }) => linkTeamToPipelineFor(me, data.pipelineId, data.teamId))

export const unlinkTeamFromPipeline = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(teamLink)
  .handler(({ data, context: { auth: me } }) => unlinkTeamFromPipelineFor(me, data.pipelineId, data.teamId))
