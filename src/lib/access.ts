export const userRoles = ['SUPER_ADMIN', 'TENANT_ADMIN', 'MEMBER'] as const
export type Role = (typeof userRoles)[number]

/** O que um convite ou cadastro novo pode atribuir como papel de tenant: líder é papel de equipe, não de tenant. */
export const assignableRoles = ['TENANT_ADMIN', 'MEMBER'] as const
export type AssignableRole = (typeof assignableRoles)[number]

export const teamRoles = ['LEADER', 'MEMBER'] as const
export type TeamRole = (typeof teamRoles)[number]
