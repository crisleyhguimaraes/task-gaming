export const userRoles = ['SUPER_ADMIN', 'TENANT_ADMIN', 'TEAM_LEADER', 'MEMBER'] as const
export type Role = (typeof userRoles)[number]

export const teamRoles = ['LEADER', 'MEMBER'] as const
export type TeamRole = (typeof teamRoles)[number]
