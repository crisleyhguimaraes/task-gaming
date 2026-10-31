// Regras de papel/visibilidade. Puro: sem db, sem imports de servidor (vai pro bundle do cliente via middleware).
import type { Role, TeamRole } from '#/lib/access'

export type Membership = { teamId: string; role: TeamRole }

export type AuthCtx = {
  userId: string
  tenantId: string
  role: Role
  memberships: ReadonlyArray<Membership>
  name: string
  impersonatedBy: string | null
  mustChangePassword: boolean
  /** Ajustes do tenant por papel dentro da equipe (role_capabilities). Papel ausente = padrão de fábrica. */
  capabilityOverrides: Partial<Record<TeamRole, CapabilityOverrides>>
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

/** Quem recebe a capability: admin pelo papel de tenant, os demais pelo papel na equipe. */
type Grantee = Role | TeamRole

const MANAGERS: ReadonlyArray<Grantee> = ['SUPER_ADMIN', 'TENANT_ADMIN', 'LEADER']
const ADMINS: ReadonlyArray<Grantee> = ['SUPER_ADMIN', 'TENANT_ADMIN']
const EVERYONE: ReadonlyArray<Grantee> = ['SUPER_ADMIN', 'TENANT_ADMIN', 'LEADER', 'MEMBER']

/** Padrão de fábrica. Escopo (tenant/equipe) continua em canManage/canSee; isto só diz "quem pode tentar". */
export const defaultGrants = {
  'tenant.manage': ['SUPER_ADMIN'],
  'tenant.configure': ADMINS,
  'team.manage': ADMINS,
  'team.link': ADMINS,
  'team.member.manage': ADMINS,
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
  'goal.configure': ADMINS,
  'scoring.configure': ADMINS,
  'board.manage': MANAGERS,
  'challenge.write': EVERYONE,
  'challenge.share': MANAGERS,
  'challenge.validate': MANAGERS,
  'lead.write': EVERYONE,
  'lead.import': MANAGERS,
  'opportunity.write': EVERYONE,
  'opportunity.reopen': MANAGERS,
} satisfies Record<string, ReadonlyArray<Grantee>>

export type Capability = keyof typeof defaultGrants
export const capabilities = Object.keys(defaultGrants) as Array<Capability>

export type CapabilityOverrides = Partial<Record<Capability, boolean>>

export type CapabilityScope = 'tenant' | 'team'

/**
 * `tenant`: vale para a organização toda, então não é delegável (override é por papel, e delegar daria a um líder poder sobre o tenant).
 * `team`: vale dentro de uma equipe e o tenant pode ajustar por papel.
 */
export const capabilityScope: Record<Capability, CapabilityScope> = {
  'tenant.manage': 'tenant',
  'tenant.configure': 'tenant',
  'team.manage': 'tenant',
  'team.link': 'team',
  'team.member.manage': 'team',
  'user.read': 'team',
  'user.create': 'team',
  'user.update': 'tenant',
  'user.deactivate': 'team',
  'invitation.manage': 'team',
  'permissions.manage': 'tenant',
  'audit.read': 'tenant',
  'task.restore': 'team',
  'export.csv': 'team',
  'pipeline.configure': 'tenant',
  'goal.configure': 'tenant',
  'scoring.configure': 'tenant',
  'board.manage': 'team',
  'challenge.write': 'team',
  'challenge.share': 'team',
  'challenge.validate': 'team',
  'lead.write': 'team',
  'lead.import': 'team',
  'opportunity.write': 'team',
  'opportunity.reopen': 'team',
}

export const nonDelegableCapabilities = capabilities.filter((c) => capabilityScope[c] === 'tenant')

const grantedTo = (capability: Capability): ReadonlyArray<Grantee> => defaultGrants[capability]

/** O que o papel pode numa equipe: override do tenant sobre o padrão, e override de capability de escopo `tenant` nunca vale, mesmo gravado. */
export function teamRoleCan(teamRole: TeamRole, capability: Capability, overrides: AuthCtx['capabilityOverrides']) {
  const override = capabilityScope[capability] === 'team' ? overrides[teamRole]?.[capability] : undefined
  return override ?? grantedTo(capability).includes(teamRole)
}

type CanCtx = Pick<AuthCtx, 'role' | 'memberships' | 'capabilityOverrides'>

/**
 * Sem `teamId` é só o portão de entrada ("pode em alguma equipe"): quem lista dados filtra por `teamIdsOf(me, capability)`.
 * Quem não tem equipe e não é admin vale como membro, o padrão de quem ainda não foi vinculado.
 */
export function can(me: CanCtx, capability: Capability, teamId?: string) {
  if (isAdmin(me)) return grantedTo(capability).includes(me.role)
  const roles = teamId === undefined ? entryRoles(me) : [roleIn(me, teamId)]
  return roles.some((role) => role !== null && teamRoleCan(role, capability, me.capabilityOverrides))
}

const entryRoles = (me: CanCtx): ReadonlyArray<TeamRole> => (me.memberships.length ? me.memberships.map((m) => m.role) : ['MEMBER'])

export function requireCan(me: CanCtx, capability: Capability, teamId?: string) {
  if (!can(me, capability, teamId)) forbid()
}

export const isAdmin = (me: Pick<AuthCtx, 'role'>) => me.role === 'SUPER_ADMIN' || me.role === 'TENANT_ADMIN'

export const roleIn = (me: Pick<AuthCtx, 'memberships'>, teamId: string): TeamRole | null => me.memberships.find((m) => m.teamId === teamId)?.role ?? null

export const isMemberOf = (me: Pick<AuthCtx, 'memberships'>, teamId: string) => roleIn(me, teamId) !== null

/** A equipe que uma tela seleciona de início: a primeira dos meus vínculos que a lista oferece; sem nenhuma, a primeira da lista. */
export const defaultTeamId = (me: Pick<AuthCtx, 'memberships'>, teams: ReadonlyArray<{ id: string }>) =>
  me.memberships.find((m) => teams.some((t) => t.id === m.teamId))?.teamId ?? teams[0]?.id ?? ''

/** Admin gerencia tudo do tenant; líder gerencia as equipes que lidera. */
export const canManage = (me: Pick<AuthCtx, 'role' | 'memberships'>, record: { teamId: string }) => isAdmin(me) || roleIn(me, record.teamId) === 'LEADER'

/** Gerencia a equipe e tem a capability nela: a capability sozinha, dada ao membro por override, não faz dele gestor. */
export const canManageWith = (me: CanCtx, capability: Capability, teamId: string) => canManage(me, { teamId }) && can(me, capability, teamId)

/** Admin entra em qualquer equipe do tenant; os demais, nas que integram. */
export const canAccessTeam = (me: Pick<AuthCtx, 'role' | 'memberships'>, teamId: string) => isAdmin(me) || isMemberOf(me, teamId)

export const canSee = (me: Pick<AuthCtx, 'userId' | 'role' | 'memberships'>, record: { teamId: string; assignedToId: string | null }) =>
  canManage(me, record) || record.assignedToId === me.userId || roleIn(me, record.teamId) !== null

export const managedTeamIds = (me: Pick<AuthCtx, 'memberships'>) => me.memberships.filter((m) => m.role === 'LEADER').map((m) => m.teamId)

export const isManager = (me: Pick<AuthCtx, 'role' | 'memberships'>) => isAdmin(me) || managedTeamIds(me).length > 0
