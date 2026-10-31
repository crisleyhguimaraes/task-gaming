import { and, asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { auditEvents, tenants } from '#/db/schema'
import type { AuthCtx } from './roles'
import { getTenantSettingsFor, updateTenantSettingsFor } from './tenant-settings.core'
import { addAdmin, makeTenant } from './test-fixtures'

let f: Awaited<ReturnType<typeof makeTenant>>
let other: Awaited<ReturnType<typeof makeTenant>>
let admin: AuthCtx

const valid = { timezone: 'America/Manaus', requireTwoFactor: true }

const stored = async (tenantId: string) => (await db.select().from(tenants).where(eq(tenants.id, tenantId)))[0]!
const configuredEvents = (tenantId: string) =>
  db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.tenantId, tenantId), eq(auditEvents.action, 'tenant.configured')))
    .orderBy(asc(auditEvents.createdAt))

beforeAll(async () => {
  f = await makeTenant(1)
  other = await makeTenant(0)
  admin = await addAdmin(f)
})
afterAll(async () => {
  await f.cleanup()
  await other.cleanup()
  await db.$client.end()
})

describe('configurações do tenant', () => {
  it('admin altera fuso e 2FA obrigatório', async () => {
    await updateTenantSettingsFor(admin, valid)

    expect(await getTenantSettingsFor(admin)).toEqual(valid)
  })

  it('audita o antes e o depois, só do que mudou', async () => {
    await updateTenantSettingsFor(admin, { timezone: 'America/Sao_Paulo', requireTwoFactor: false })
    const before = (await configuredEvents(f.tenant.id)).length

    await updateTenantSettingsFor(admin, { timezone: 'America/Sao_Paulo', requireTwoFactor: true })

    const events = await configuredEvents(f.tenant.id)
    expect(events).toHaveLength(before + 1)
    expect(events.at(-1)).toMatchObject({ actorId: admin.userId, entityType: 'tenant', entityId: f.tenant.id, changes: { requireTwoFactor: { from: false, to: true } } })
    expect(Object.keys(events.at(-1)!.changes!)).toEqual(['requireTwoFactor'])
  })

  it('salvar sem mudar nada não gera evento', async () => {
    const current = await getTenantSettingsFor(admin)
    const before = (await configuredEvents(f.tenant.id)).length

    await updateTenantSettingsFor(admin, current)

    expect(await configuredEvents(f.tenant.id)).toHaveLength(before)
  })

  it.each(['Marte/Olympus', '', 'sao paulo'])('rejeita fuso inválido %j sem alterar o tenant', async (timezone) => {
    const before = await stored(f.tenant.id)

    await expect(updateTenantSettingsFor(admin, { ...valid, timezone })).rejects.toThrow('Fuso horário')

    expect(await stored(f.tenant.id)).toEqual(before)
  })

  it('líder e membro não têm a capability', async () => {
    const before = await stored(f.tenant.id)

    await expect(updateTenantSettingsFor(f.leader, valid)).rejects.toThrow('Sem permissão')
    await expect(updateTenantSettingsFor(f.members[0]!, valid)).rejects.toThrow('Sem permissão')

    expect(await stored(f.tenant.id)).toEqual(before)
  })

  it('só altera o tenant da sessão', async () => {
    const untouched = await stored(other.tenant.id)

    await updateTenantSettingsFor(admin, { ...valid, timezone: 'Asia/Tokyo' })

    expect(await stored(other.tenant.id)).toEqual(untouched)
    expect(await configuredEvents(other.tenant.id)).toHaveLength(0)
  })
})
