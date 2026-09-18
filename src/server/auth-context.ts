import { redirect } from '@tanstack/react-router'
import { createMiddleware } from '@tanstack/react-start'

export type { AuthCtx } from './roles'
export { isAdmin, requireRole } from './roles'

/** Injeta `context.auth` nas server functions. O import server-only fica dentro do .server() (removido do cliente). */
export const authMiddleware = createMiddleware({ type: 'function' }).server(async ({ next }) => {
  const { getAuthCtx } = await import('./session.server')
  const ctx = await getAuthCtx()
  if (!ctx) throw redirect({ to: '/login' })
  return next({ context: { auth: ctx } })
})
