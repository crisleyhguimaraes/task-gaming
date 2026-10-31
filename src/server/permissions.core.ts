import { and, eq } from 'drizzle-orm'
import { db } from '#/db'
import type { TeamRole } from '#/lib/access'
import { teamRoles } from '#/lib/access'
import { roleCapabilities } from '#/db/schema'
import { recordAudit } from './audit.core'
import type { AuthCtx, Capability, CapabilityOverrides } from './roles'
import { capabilities, fail, nonDelegableCapabilities, requireCan, teamRoleCan } from './roles'

export async function overridesByTeamRole(tenantId: string): Promise<AuthCtx['capabilityOverrides']> {
  const rows = await db
    .select({ role: roleCapabilities.role, capability: roleCapabilities.capability, allowed: roleCapabilities.allowed })
    .from(roleCapabilities)
    .where(eq(roleCapabilities.tenantId, tenantId))
  const byRole: Partial<Record<TeamRole, CapabilityOverrides>> = {}
  for (const { role, capability, allowed } of rows) byRole[role] = { ...byRole[role], [capability]: allowed }
  return byRole
}

export async function setCapabilityFor(me: AuthCtx, role: TeamRole, capability: Capability, allowed: boolean) {
  requireCan(me, 'permissions.manage')
  if (!teamRoles.includes(role)) fail('Permissões de administrador não podem ser alteradas')
  if (!capabilities.includes(capability)) fail('Permissão desconhecida')
  if (nonDelegableCapabilities.includes(capability)) fail('Esta permissão não pode ser delegada')

  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ allowed: roleCapabilities.allowed })
      .from(roleCapabilities)
      .where(and(eq(roleCapabilities.tenantId, me.tenantId), eq(roleCapabilities.role, role), eq(roleCapabilities.capability, capability)))
    const was = row?.allowed ?? teamRoleCan(role, capability, {})
    await tx
      .insert(roleCapabilities)
      .values({ tenantId: me.tenantId, role, capability, allowed })
      .onConflictDoUpdate({ target: [roleCapabilities.tenantId, roleCapabilities.role, roleCapabilities.capability], set: { allowed } })
    if (was === allowed) return
    await recordAudit(tx, me, { action: 'permissions.changed', entityType: 'role', entityId: role, changes: { [capability]: { from: was, to: allowed } } })
  })
}

export async function overridesByRoleFor(me: AuthCtx) {
  requireCan(me, 'permissions.manage')
  return overridesByTeamRole(me.tenantId)
}
