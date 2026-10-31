import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { authMiddleware } from './auth-context'
import { overridesByRoleFor, setCapabilityFor } from './permissions.core'
import { teamRoles } from '#/lib/access'
import { capabilities } from './roles'

export const getCapabilityOverrides = createServerFn()
  .middleware([authMiddleware])
  .handler(({ context: { auth: me } }) => overridesByRoleFor(me))

export const setCapability = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ role: z.enum(teamRoles), capability: z.enum(capabilities), allowed: z.boolean() }))
  .handler(({ data, context: { auth: me } }) => setCapabilityFor(me, data.role, data.capability, data.allowed))
