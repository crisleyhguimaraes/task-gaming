import { and, eq } from 'drizzle-orm'
import { db } from '#/db'
import type { Role } from '#/db/schema'
import { roleCapabilities } from '#/db/schema'
import { recordAudit } from './audit.core'
import type { AuthCtx, Capability, CapabilityOverrides, OverridableRole } from './roles'
import { can, capabilities, fail, nonDelegableCapabilities, overridableRoles, requireCan } from './roles'

export async function capabilityOverridesFor(tenantId: string, role: Role): Promise<CapabilityOverrides> {
  const rows = await db
    .select({ capability: roleCapabilities.capability, allowed: roleCapabilities.allowed })
    .from(roleCapabilities)
    .where(and(eq(roleCapabilities.tenantId, tenantId), eq(roleCapabilities.role, role)))
  return Object.fromEntries(rows.map((r) => [r.capability, r.allowed]))
}

export async function setCapabilityFor(me: AuthCtx, role: OverridableRole, capability: Capability, allowed: boolean) {
  requireCan(me, 'permissions.manage')
  if (!overridableRoles.includes(role)) fail('Permissões de administrador não podem ser alteradas')
  if (!capabilities.includes(capability)) fail('Permissão desconhecida')
  if (nonDelegableCapabilities.includes(capability)) fail('Esta permissão não pode ser delegada')

  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ allowed: roleCapabilities.allowed })
      .from(roleCapabilities)
      .where(and(eq(roleCapabilities.tenantId, me.tenantId), eq(roleCapabilities.role, role), eq(roleCapabilities.capability, capability)))
    const was = row?.allowed ?? can({ role }, capability)
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
  const [TEAM_LEADER, MEMBER] = await Promise.all([capabilityOverridesFor(me.tenantId, 'TEAM_LEADER'), capabilityOverridesFor(me.tenantId, 'MEMBER')])
  return { TEAM_LEADER, MEMBER }
}
