// Regras de papel/visibilidade. Puro: sem db, sem imports de servidor (vai pro bundle do cliente via middleware).
import type { Role } from '#/db/schema'

export type AuthCtx = {
  userId: string
  tenantId: string
  teamId: string | null
  role: Role
  name: string
  impersonatedBy: string | null
  mustChangePassword: boolean
}

export function fail(message: string): never {
  throw new Error(message)
}

export function requireRole(ctx: AuthCtx, ...roles: Array<Role>) {
  if (!roles.includes(ctx.role)) fail('Sem permissão')
}

export const isAdmin = (me: AuthCtx) => me.role === 'SUPER_ADMIN' || me.role === 'TENANT_ADMIN'

/** Admin gerencia tudo do tenant; líder gerencia o próprio time. */
export const canManage = (me: AuthCtx, task: { teamId: string }) =>
  isAdmin(me) || (me.role === 'TEAM_LEADER' && me.teamId === task.teamId)

export const canSee = (me: AuthCtx, task: { teamId: string; assignedToId: string | null }) =>
  canManage(me, task) || task.assignedToId === me.userId || task.teamId === me.teamId
