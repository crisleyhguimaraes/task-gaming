import { adminClient, inferAdditionalFields, twoFactorClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'
import type { auth } from './auth'
import { ac, roles } from './permissions'

export const authClient = createAuthClient({
  plugins: [adminClient({ ac, roles }), twoFactorClient({ twoFactorPage: '/two-factor' }), inferAdditionalFields<typeof auth>()],
})
