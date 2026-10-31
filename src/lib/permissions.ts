import { createAccessControl } from 'better-auth/plugins/access'
import { adminAc, defaultStatements } from 'better-auth/plugins/admin/access'

// Só o plugin admin usa isto (createUser/impersonate/ban via HTTP).
// Autorização de negócio (tenant/time) fica em server/auth-context.ts.
export const ac = createAccessControl(defaultStatements)

const none = ac.newRole({})
export const roles = {
  SUPER_ADMIN: ac.newRole(adminAc.statements),
  TENANT_ADMIN: none,
  MEMBER: none,
}
