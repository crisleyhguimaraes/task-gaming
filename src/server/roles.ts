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

const MANAGERS: ReadonlyArray<Role> = ['SUPER_ADMIN', 'TENANT_ADMIN', 'TEAM_LEADER']
const ADMINS: ReadonlyArray<Role> = ['SUPER_ADMIN', 'TENANT_ADMIN']
const EVERYONE: ReadonlyArray<Role> = ['SUPER_ADMIN', 'TENANT_ADMIN', 'TEAM_LEADER', 'MEMBER']

/** Padrão de fábrica. Escopo (tenant/equipe) continua em canManage/canSee; isto só diz "quem pode tentar". */
export const defaultGrants = {
  'tenant.manage': ['SUPER_ADMIN'],
  'tenant.configure': ADMINS,
  'team.manage': ADMINS,
  'user.read': MANAGERS,
  'user.create': MANAGERS,
  'user.update': ADMINS,
  'user.deactivate': ADMINS,
  'invitation.manage': MANAGERS,
  'permissions.manage': ADMINS,
  'audit.read': ADMINS,
  'task.restore': MANAGERS,
  'export.csv': MANAGERS,
  'pipeline.configure': ADMINS,
  'lead.write': EVERYONE,
  'lead.import': MANAGERS,
  'opportunity.write': EVERYONE,
  'opportunity.reopen': MANAGERS,
} satisfies Record<string, ReadonlyArray<Role>>

export type Capability = keyof typeof defaultGrants
export const capabilities = Object.keys(defaultGrants) as Array<Capability>

const grantedTo = (capability: Capability): ReadonlyArray<Role> => defaultGrants[capability]

export const can = (ctx: Pick<AuthCtx, 'role'>, capability: Capability) => grantedTo(capability).includes(ctx.role)

export function requireCan(ctx: Pick<AuthCtx, 'role'>, capability: Capability) {
  if (!can(ctx, capability)) fail('Sem permissão')
}

export const isAdmin = (me: AuthCtx) => me.role === 'SUPER_ADMIN' || me.role === 'TENANT_ADMIN'

/** Admin gerencia tudo do tenant; líder gerencia o próprio time. */
export const canManage = (me: AuthCtx, task: { teamId: string }) =>
  isAdmin(me) || (me.role === 'TEAM_LEADER' && me.teamId === task.teamId)

export const canSee = (me: AuthCtx, task: { teamId: string; assignedToId: string | null }) =>
  canManage(me, task) || task.assignedToId === me.userId || task.teamId === me.teamId
