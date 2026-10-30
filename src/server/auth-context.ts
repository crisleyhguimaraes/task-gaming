import { redirect } from '@tanstack/react-router'
import { createMiddleware } from '@tanstack/react-start'

export type { AuthCtx } from './roles'
export { can, isAdmin, requireCan } from './roles'

/** Injeta `context.auth` nas server functions e audita as negações. O import server-only fica dentro do .server() (removido do cliente). */
export const authMiddleware = createMiddleware({ type: 'function' }).server(async ({ next, serverFnMeta }) => {
  const [{ getAuthCtx }, { auditDenials }] = await Promise.all([import('./session.server'), import('./access.core')])
  const ctx = await getAuthCtx()
  if (!ctx) throw redirect({ to: '/login' })
  return auditDenials(ctx, { function: serverFnMeta.name }, () => next({ context: { auth: ctx } }))
})
