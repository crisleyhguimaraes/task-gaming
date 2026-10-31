import { readFileSync } from 'node:fs'
import { and, asc, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Role } from '#/db/schema'
import { db } from '#/db'
import { auditEvents, roleCapabilities } from '#/db/schema'
import { listAuditPageFor } from './audit-view.core'
import { capabilityOverridesFor, overridesByRoleFor, setCapabilityFor } from './permissions.core'
import type { AuthCtx } from './roles'
import { ForbiddenError, can, nonDelegableCapabilities, requireCan } from './roles'
import { addAdmin, makeTenant } from './test-fixtures'

let f: Awaited<ReturnType<typeof makeTenant>>
let other: Awaited<ReturnType<typeof makeTenant>>
let admin: AuthCtx

const withOverrides = async (ctx: AuthCtx): Promise<AuthCtx> => ({
  ...ctx,
  capabilityOverrides: await capabilityOverridesFor(ctx.tenantId, ctx.role),
})

const permissionEvents = () =>
  db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.tenantId, f.tenant.id), eq(auditEvents.action, 'permissions.changed')))
    .orderBy(asc(auditEvents.createdAt))

beforeAll(async () => {
  f = await makeTenant(1)
  other = await makeTenant(1)
  admin = await addAdmin(f)
})
afterAll(async () => {
  await f.cleanup()
  await other.cleanup()
  await db.$client.end()
})

describe('permissões por tenant', () => {
  it('sem linhas no banco vale o padrão de fábrica', async () => {
    const member = await withOverrides(f.members[0]!)

    expect(member.capabilityOverrides).toEqual({})
    expect(can(member, 'export.csv')).toBe(false)
    expect(can(await withOverrides(f.leader), 'user.create')).toBe(true)
  })

  it('conceder export.csv ao membro vale para o contexto carregado do banco', async () => {
    await setCapabilityFor(admin, 'MEMBER', 'export.csv', true)

    const member = await withOverrides(f.members[0]!)

    expect(can(member, 'export.csv')).toBe(true)
    expect(() => requireCan(member, 'export.csv')).not.toThrow()
    expect(can(member, 'user.create')).toBe(false)
  })

  it('revogar user.create do líder faz requireCan negar com ForbiddenError', async () => {
    await setCapabilityFor(admin, 'TEAM_LEADER', 'user.create', false)

    const leader = await withOverrides(f.leader)

    expect(() => requireCan(leader, 'user.create')).toThrow(ForbiddenError)
    expect(can(leader, 'invitation.manage')).toBe(true)
  })

  it('alterar de novo a mesma capability atualiza a linha em vez de duplicar', async () => {
    await setCapabilityFor(admin, 'MEMBER', 'export.csv', false)

    expect(await capabilityOverridesFor(f.tenant.id, 'MEMBER')).toEqual({ 'export.csv': false })
  })

  it('o ajuste de um tenant não vaza para outro', async () => {
    await setCapabilityFor(admin, 'MEMBER', 'export.csv', true)

    expect(await capabilityOverridesFor(other.tenant.id, 'MEMBER')).toEqual({})
    expect(can(await withOverrides(other.members[0]!), 'export.csv')).toBe(false)
  })

  it('o ajuste de um papel não vaza para outro papel', async () => {
    expect(await capabilityOverridesFor(f.tenant.id, 'TEAM_LEADER')).not.toHaveProperty('export.csv')
  })
})

describe('setCapabilityFor: validações', () => {
  it.each<Role>(['TENANT_ADMIN', 'SUPER_ADMIN'])('não altera permissões de %s', async (role) => {
    await expect(setCapabilityFor(admin, role as 'MEMBER', 'audit.read', false)).rejects.toThrow('administrador')

    expect(await capabilityOverridesFor(f.tenant.id, role)).toEqual({})
  })

  it('recusa capability desconhecida', async () => {
    await expect(setCapabilityFor(admin, 'MEMBER', 'nao.existe' as 'export.csv', true)).rejects.toThrow('desconhecida')
  })

  it.each(nonDelegableCapabilities)('não delega %s a papéis do tenant', async (capability) => {
    await expect(setCapabilityFor(admin, 'TEAM_LEADER', capability, true)).rejects.toThrow('delegada')

    expect(await capabilityOverridesFor(f.tenant.id, 'TEAM_LEADER')).not.toHaveProperty(capability)
  })

  it('exige permissions.manage de quem altera', async () => {
    await expect(setCapabilityFor(f.leader, 'MEMBER', 'export.csv', true)).rejects.toThrow(ForbiddenError)
  })
})

describe('overridesByRoleFor', () => {
  it('devolve os ajustes dos dois papéis editáveis, só para quem gerencia permissões', async () => {
    await setCapabilityFor(admin, 'TEAM_LEADER', 'user.deactivate', true)

    const byRole = await overridesByRoleFor(admin)

    expect(byRole.TEAM_LEADER).toMatchObject({ 'user.deactivate': true })
    expect(byRole.MEMBER).not.toHaveProperty('user.deactivate')
    await expect(overridesByRoleFor(f.members[0]!)).rejects.toThrow(ForbiddenError)
  })
})

describe('auditoria de permissões', () => {
  it('registra o valor efetivo anterior e o novo, com o papel como entidade', async () => {
    const before = (await permissionEvents()).length

    await setCapabilityFor(admin, 'MEMBER', 'lead.import', true)

    const events = await permissionEvents()
    expect(events).toHaveLength(before + 1)
    expect(events.at(-1)).toMatchObject({
      actorId: admin.userId,
      entityType: 'role',
      entityId: 'MEMBER',
      changes: { 'lead.import': { from: false, to: true } },
    })
  })

  it('repetir o valor efetivo não gera evento', async () => {
    await setCapabilityFor(admin, 'MEMBER', 'lead.import', true)
    const before = (await permissionEvents()).length

    await setCapabilityFor(admin, 'MEMBER', 'lead.import', true)

    expect(await permissionEvents()).toHaveLength(before)
  })
})

describe('capability não delegável gravada direto no banco', () => {
  it('não vale: líder com audit.read gravado continua sem ver a auditoria', async () => {
    const g = await makeTenant(0)
    try {
      await db.insert(roleCapabilities).values({ tenantId: g.tenant.id, role: 'TEAM_LEADER', capability: 'audit.read', allowed: true })
      const leader = await withOverrides(g.leader)

      expect(leader.capabilityOverrides).toEqual({ 'audit.read': true })
      expect(can(leader, 'audit.read')).toBe(false)
      await expect(listAuditPageFor(leader, {})).rejects.toThrow(ForbiddenError)
    } finally {
      await g.cleanup()
    }
  })
})

describe('migração que limpa overrides não delegáveis', () => {
  it('apaga os overrides gravados de capabilities não delegáveis e preserva os delegáveis', async () => {
    const g = await makeTenant(0)
    const migration = readFileSync(new URL('../../drizzle/0008_limpa_overrides_nao_delegaveis.sql', import.meta.url), 'utf8')
    try {
      await db.insert(roleCapabilities).values(
        ['tenant.configure', 'team.manage', 'audit.read', 'pipeline.configure', 'export.csv'].map((capability) => ({ tenantId: g.tenant.id, role: 'TEAM_LEADER' as const, capability, allowed: true })),
      )

      await db.execute(sql.raw(migration))

      expect(await capabilityOverridesFor(g.tenant.id, 'TEAM_LEADER')).toEqual({ 'export.csv': true })
    } finally {
      await g.cleanup()
    }
  })
})
