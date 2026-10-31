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
  /** Ajustes do tenant sobre o papel do usuário (role_capabilities). Ausente = padrão de fábrica. */
  capabilityOverrides?: CapabilityOverrides
}

export function fail(message: string): never {
  throw new Error(message)
}

/** Tipado para o authMiddleware distinguir negação de acesso de erro comum e auditar só a primeira. */
export class ForbiddenError extends Error {
  constructor() {
    super('Sem permissão')
    this.name = 'ForbiddenError'
  }
}

export function forbid(): never {
  throw new ForbiddenError()
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

export type CapabilityOverrides = Partial<Record<Capability, boolean>>

/** Admin fica de fora de propósito: ninguém consegue trancar o próprio tenant. */
export const overridableRoles = ['TEAM_LEADER', 'MEMBER'] as const satisfies ReadonlyArray<Role>
export type OverridableRole = (typeof overridableRoles)[number]

/** Escopo de tenant ou plataforma: override é por papel, sem equipe, então delegar daria a um líder poder sobre a organização toda. */
export const nonDelegableCapabilities: ReadonlyArray<Capability> = ['tenant.manage', 'tenant.configure', 'team.manage', 'permissions.manage', 'audit.read', 'pipeline.configure']

const grantedTo = (capability: Capability): ReadonlyArray<Role> => defaultGrants[capability]

/** Override de capability não delegável é ignorado: se já estiver gravado, não vale. */
export const can = (ctx: Pick<AuthCtx, 'role' | 'capabilityOverrides'>, capability: Capability) => {
  const override = nonDelegableCapabilities.includes(capability) ? undefined : ctx.capabilityOverrides?.[capability]
  return override ?? grantedTo(capability).includes(ctx.role)
}

export function requireCan(ctx: Pick<AuthCtx, 'role' | 'capabilityOverrides'>, capability: Capability) {
  if (!can(ctx, capability)) forbid()
}

export const isAdmin = (me: AuthCtx) => me.role === 'SUPER_ADMIN' || me.role === 'TENANT_ADMIN'

/** Admin gerencia tudo do tenant; líder gerencia o próprio time. */
export const canManage = (me: AuthCtx, task: { teamId: string }) =>
  isAdmin(me) || (me.role === 'TEAM_LEADER' && me.teamId === task.teamId)

export const canSee = (me: AuthCtx, task: { teamId: string; assignedToId: string | null }) =>
  canManage(me, task) || task.assignedToId === me.userId || task.teamId === me.teamId
