import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { teamRoles } from '#/lib/access'
import { authMiddleware } from './auth-context'
import { addTeamMemberFor, removeTeamMemberFor, setTeamMemberRoleFor } from './team-members.core'

const membership = z.object({ userId: z.string(), teamId: z.uuid() })
const roleChange = membership.extend({ role: z.enum(teamRoles) })

export const addTeamMember = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(roleChange)
  .handler(({ data, context: { auth: me } }) => addTeamMemberFor(me, data))

export const removeTeamMember = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(membership)
  .handler(({ data, context: { auth: me } }) => removeTeamMemberFor(me, data))

export const setTeamMemberRole = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(roleChange)
  .handler(({ data, context: { auth: me } }) => setTeamMemberRoleFor(me, data))
