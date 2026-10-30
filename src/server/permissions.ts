import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { authMiddleware } from './auth-context'
import { overridesByRoleFor, setCapabilityFor } from './permissions.core'
import { capabilities, overridableRoles } from './roles'

export const getCapabilityOverrides = createServerFn()
  .middleware([authMiddleware])
  .handler(({ context: { auth: me } }) => overridesByRoleFor(me))

export const setCapability = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ role: z.enum(overridableRoles), capability: z.enum(capabilities), allowed: z.boolean() }))
  .handler(({ data, context: { auth: me } }) => setCapabilityFor(me, data.role, data.capability, data.allowed))
