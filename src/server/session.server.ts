import { getRequestHeaders } from '@tanstack/react-start/server'
import { auth } from '#/lib/auth'
import type { AuthCtx } from './roles'

export async function getAuthCtx(): Promise<AuthCtx | null> {
  const s = await auth.api.getSession({ headers: getRequestHeaders() })
  if (!s) return null
  return {
    userId: s.user.id,
    tenantId: s.user.tenantId,
    teamId: s.user.teamId ?? null,
    role: s.user.role as AuthCtx['role'],
    name: s.user.name,
    impersonatedBy: s.session.impersonatedBy ?? null,
    mustChangePassword: s.user.mustChangePassword ?? false,
  }
}
