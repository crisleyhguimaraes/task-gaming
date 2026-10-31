import { getRequestHeaders } from '@tanstack/react-start/server'
import { auth } from '#/lib/auth'
import type { Role } from '#/lib/access'
import { loadAuthCtx } from './auth-context.core'
import type { AuthCtx } from './roles'

export async function getAuthCtx(): Promise<AuthCtx | null> {
  const s = await auth.api.getSession({ headers: getRequestHeaders() })
  if (!s) return null
  return loadAuthCtx({ ...s.user, role: s.user.role as Role }, s.session)
}
