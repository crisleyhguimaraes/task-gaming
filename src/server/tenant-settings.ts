import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { authMiddleware } from './auth-context'
import { getTenantSettingsFor, supportedTimeZones, updateTenantSettingsFor } from './tenant-settings.core'

export const getTenantSettings = createServerFn()
  .middleware([authMiddleware])
  .handler(async ({ context: { auth: me } }) => ({ settings: await getTenantSettingsFor(me), timeZones: supportedTimeZones() }))

export const updateTenantSettings = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ timezone: z.string(), requireTwoFactor: z.boolean() }))
  .handler(({ data, context: { auth: me } }) => updateTenantSettingsFor(me, data))
