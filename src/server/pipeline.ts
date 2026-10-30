import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { authMiddleware } from './auth-context'
import { convertLeadFor, funnelFor, getOpportunityFor, listPipelineFor, moveOpportunityFor, pipelineFiltersFor, updateOpportunityFor } from './pipeline.core'
import { createStageFor, deleteStageFor, listStagesFor, reorderStageFor, updateStageFor } from './stages.core'

const MAX_TITLE = 200
const MAX_LOST_REASON = 500
const stageKind = z.enum(['open', 'won', 'lost'])

const opportunityFields = {
  title: z.string().trim().min(2).max(MAX_TITLE),
  amountCents: z.int().min(0),
  expectedCloseDate: z.iso.date().nullable(),
}

export const listPipeline = createServerFn()
  .middleware([authMiddleware])
  .validator(z.object({ teamId: z.uuid().optional(), ownerId: z.string().optional() }))
  .handler(({ data, context: { auth: me } }) => listPipelineFor(me, data))

export const getPipelineFilters = createServerFn()
  .middleware([authMiddleware])
  .validator(z.object({ teamId: z.uuid().optional() }))
  .handler(({ data, context: { auth: me } }) => pipelineFiltersFor(me, data.teamId))

export const getFunnel = createServerFn()
  .middleware([authMiddleware])
  .validator(z.object({ from: z.iso.datetime(), to: z.iso.datetime(), teamId: z.uuid().optional() }))
  .handler(({ data, context: { auth: me } }) => funnelFor(me, { from: new Date(data.from), to: new Date(data.to), teamId: data.teamId }))

export const getOpportunity = createServerFn()
  .middleware([authMiddleware])
  .validator(z.object({ opportunityId: z.uuid() }))
  .handler(({ data, context: { auth: me } }) => getOpportunityFor(me, data.opportunityId))

export const updateOpportunity = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ opportunityId: z.uuid(), ...opportunityFields, ownerId: z.string().nullable() }))
  .handler(async ({ data: { opportunityId, ...fields }, context: { auth: me } }) => {
    await updateOpportunityFor(me, opportunityId, fields)
  })

export const moveOpportunity = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ opportunityId: z.uuid(), toStageId: z.uuid(), sortOrder: z.number().finite().optional(), lostReason: z.string().trim().max(MAX_LOST_REASON).optional() }))
  .handler(async ({ data, context: { auth: me } }) => {
    await moveOpportunityFor(me, data.opportunityId, data.toStageId, data)
  })

export const convertLead = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ leadId: z.uuid(), ...opportunityFields, expectedCloseDate: opportunityFields.expectedCloseDate.optional(), ownerId: z.string().nullable().optional() }))
  .handler(async ({ data: { leadId, ...fields }, context: { auth: me } }) => {
    const opportunity = await convertLeadFor(me, leadId, fields)
    return { id: opportunity.id }
  })

export const listStages = createServerFn()
  .middleware([authMiddleware])
  .handler(({ context: { auth: me } }) => listStagesFor(me))

export const createStage = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ name: z.string().trim().min(2).max(60), kind: stageKind, probability: z.int().min(0).max(100) }))
  .handler(async ({ data, context: { auth: me } }) => {
    await createStageFor(me, data)
  })

export const updateStage = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ stageId: z.uuid(), name: z.string().trim().min(2).max(60).optional(), kind: stageKind.optional(), probability: z.int().min(0).max(100).optional() }))
  .handler(async ({ data: { stageId, ...edit }, context: { auth: me } }) => {
    await updateStageFor(me, stageId, edit)
  })

export const reorderStage = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ stageId: z.uuid(), sortOrder: z.number().finite() }))
  .handler(async ({ data, context: { auth: me } }) => {
    await reorderStageFor(me, data.stageId, data.sortOrder)
  })

export const deleteStage = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ stageId: z.uuid() }))
  .handler(({ data, context: { auth: me } }) => deleteStageFor(me, data.stageId))
