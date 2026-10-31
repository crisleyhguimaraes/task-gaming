import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { leadSources, leadsPageSize, maxImportRows } from '#/lib/leads'
import { authMiddleware } from './auth-context'
import { importLeadsFor, previewLeadImportFor } from './leads-import.core'
import { assignLeadFor, claimLeadFor, createLeadFor, deleteLeadFor, getLeadFor, myTeamOptionsFor, listLeadsFor, updateLeadFor } from './leads.core'

const leadStatus = z.enum(['new', 'contacted', 'qualified', 'disqualified'])
const leadSource = z.enum(leadSources)
const leadId = z.object({ leadId: z.uuid() })

const contactFields = {
  name: z.string(),
  company: z.string().nullish(),
  email: z.string().nullish(),
  phone: z.string().nullish(),
}

export const leadSearchSchema = z.object({
  status: leadStatus.optional(),
  source: leadSource.optional(),
  ownerId: z.string().optional(),
  teamId: z.uuid().optional(),
  search: z.string().optional(),
  page: z.number().int().min(1).default(1),
})

export const listLeads = createServerFn()
  .middleware([authMiddleware])
  .validator(leadSearchSchema)
  .handler(async ({ data: { page, ...filters }, context: { auth: me } }) => ({
    ...(await listLeadsFor(me, { ...filters, limit: leadsPageSize, offset: (page - 1) * leadsPageSize })),
    page,
  }))

export const getMyTeamOptions = createServerFn()
  .middleware([authMiddleware])
  .handler(({ context: { auth: me } }) => myTeamOptionsFor(me))

export const getLead = createServerFn()
  .middleware([authMiddleware])
  .validator(leadId)
  .handler(({ data, context: { auth: me } }) => getLeadFor(me, data.leadId))

export const createLead = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(
    z.object({
      ...contactFields,
      source: leadSource.optional(),
      teamId: z.uuid(),
      ownerId: z.string().nullish(),
      force: z.boolean().optional(),
    }),
  )
  .handler(({ data: { force, ...lead }, context: { auth: me } }) => createLeadFor(me, lead, { force }))

export const updateLead = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(leadId.extend({ ...contactFields, source: leadSource, status: leadStatus }))
  .handler(async ({ data: { leadId: id, ...edit }, context: { auth: me } }) => {
    await updateLeadFor(me, id, edit)
  })

export const deleteLead = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(leadId)
  .handler(({ data, context: { auth: me } }) => deleteLeadFor(me, data.leadId))

export const claimLead = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(leadId)
  .handler(async ({ data, context: { auth: me } }) => {
    await claimLeadFor(me, data.leadId)
  })

export const assignLead = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(leadId.extend({ ownerId: z.string() }))
  .handler(({ data, context: { auth: me } }) => assignLeadFor(me, data.leadId, data.ownerId))

const importRequest = z.object({
  teamId: z.uuid(),
  rows: z.array(z.object({ ...contactFields, name: z.string().nullish(), source: z.string().nullish() })).max(maxImportRows),
})

export const previewLeadImport = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(importRequest)
  .handler(({ data, context: { auth: me } }) => previewLeadImportFor(me, data))

export const importLeads = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(importRequest.extend({ onDuplicate: z.enum(['skip', 'update']), distribute: z.enum(['none', 'least_loaded']) }))
  .handler(({ data, context: { auth: me } }) => importLeadsFor(me, data))
