import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { assignableRoles, teamRoles } from '#/lib/access'
import { authMiddleware, requireCan } from './auth-context'
import { acceptInvitationCore, cancelInvitationFor, createInvitationCore, listInvitationsFor, resendInvitationFor, validInvitation } from './invitations.core'

export const listInvitations = createServerFn()
  .middleware([authMiddleware])
  .handler(({ context: { auth: me } }) => listInvitationsFor(me))

export const createInvitation = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ email: z.email(), teamId: z.uuid().nullable(), role: z.enum(assignableRoles), teamRole: z.enum(teamRoles).default('MEMBER') }))
  .handler(async ({ data, context: { auth: me } }) => {
    requireCan(me, 'invitation.manage')
    await createInvitationCore(me, data)
  })

export const resendInvitation = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ invitationId: z.uuid() }))
  .handler(({ data, context: { auth: me } }) => {
    requireCan(me, 'invitation.manage')
    return resendInvitationFor(me, data.invitationId)
  })

export const cancelInvitation = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ invitationId: z.uuid() }))
  .handler(({ data, context: { auth: me } }) => {
    requireCan(me, 'invitation.manage')
    return cancelInvitationFor(me, data.invitationId)
  })

// --- Públicas (sem sessão) --------------------------------------------------
export const getInvitation = createServerFn()
  .validator(z.object({ token: z.string().min(10) }))
  .handler(async ({ data }) => {
    const r = await validInvitation(data.token)
    return r.status === 'valid' ? { status: r.status, email: r.inv.email, tenantName: r.tenantName, teamName: r.teamName } : { status: r.status }
  })

export const acceptInvitation = createServerFn({ method: 'POST' })
  .validator(z.object({ token: z.string().min(10), name: z.string().trim().min(2).max(120), password: z.string().min(8) }))
  .handler(({ data }) => acceptInvitationCore(data.token, data.name, data.password))
