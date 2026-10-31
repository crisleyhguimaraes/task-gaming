import { eq } from 'drizzle-orm'
import { db } from '#/db'
import { tenants } from '#/db/schema'
import { diffFields } from '#/lib/audit'
import { recordAudit } from './audit.core'
import type { AuthCtx } from './roles'
import { fail, requireCan } from './roles'

export type TenantSettings = { timezone: string; requireTwoFactor: boolean }

// O ICU lista só os nomes canônicos e omite UTC, que o Postgres aceita.
const timeZones = new Set([...Intl.supportedValuesOf('timeZone'), 'UTC'])

export const supportedTimeZones = () => [...timeZones]

const settingsColumns = { timezone: tenants.timezone, requireTwoFactor: tenants.requireTwoFactor }

function assertValid({ timezone }: TenantSettings) {
  if (!timeZones.has(timezone)) fail('Fuso horário inválido')
}

export async function getTenantSettingsFor(me: AuthCtx): Promise<TenantSettings> {
  requireCan(me, 'tenant.configure')
  const [settings] = await db.select(settingsColumns).from(tenants).where(eq(tenants.id, me.tenantId))
  return settings!
}

export async function updateTenantSettingsFor(me: AuthCtx, settings: TenantSettings) {
  requireCan(me, 'tenant.configure')
  assertValid(settings)
  await db.transaction(async (tx) => {
    const [before] = await tx.select(settingsColumns).from(tenants).where(eq(tenants.id, me.tenantId)).for('update')
    const changes = diffFields(before!, settings, ['timezone', 'requireTwoFactor'])
    if (Object.keys(changes).length === 0) return
    await tx.update(tenants).set(settings).where(eq(tenants.id, me.tenantId))
    await recordAudit(tx, me, { action: 'tenant.configured', entityType: 'tenant', entityId: me.tenantId, changes })
  })
}
