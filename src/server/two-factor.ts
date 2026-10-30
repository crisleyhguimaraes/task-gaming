import { createServerFn } from '@tanstack/react-start'
import { authMiddleware } from './auth-context'
import { twoFactorStatusFor } from './two-factor.core'

export const getTwoFactorStatus = createServerFn()
  .middleware([authMiddleware])
  .handler(({ context: { auth: me } }) => twoFactorStatusFor(me))
