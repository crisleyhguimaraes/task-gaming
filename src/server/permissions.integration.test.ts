import { readFileSync } from 'node:fs'
import { TransactionRollbackError, and, asc, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { auditEvents, roleCapabilities } from '#/db/schema'
import type { Role, TeamRole } from '#/lib/access'
import { listAuditPageFor } from './audit-view.core'
import { overridesByRoleFor, overridesByTeamRole, setCapabilityFor } from './permissions.core'
import type { AuthCtx } from './roles'
import { ForbiddenError, can, nonDelegableCapabilities, requireCan } from './roles'
import { addAdmin, ctxFor, makeTenant } from './test-fixtures'

let f: Awaited<ReturnType<typeof makeTenant>>
let other: Awaited<ReturnType<typeof makeTenant>>
let admin: AuthCtx

const overridesOf = async (tenantId: string, role: TeamRole) => (await overridesByTeamRole(tenantId))[role] ?? {}

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
    const member = await ctxFor(f.members[0]!.userId)

    expect(member.capabilityOverrides).toEqual({})
    expect(can(member, 'export.csv')).toBe(false)
    expect(can(await ctxFor(f.leader.userId), 'user.create')).toBe(true)
  })

  it('conceder export.csv ao membro vale para o contexto carregado do banco', async () => {
    await setCapabilityFor(admin, 'MEMBER', 'export.csv', true)

    const member = await ctxFor(f.members[0]!.userId)

    expect(can(member, 'export.csv')).toBe(true)
    expect(() => requireCan(member, 'export.csv')).not.toThrow()
    expect(can(member, 'user.create')).toBe(false)
  })

  it('revogar user.create do líder faz requireCan negar com ForbiddenError', async () => {
    await setCapabilityFor(admin, 'LEADER', 'user.create', false)

    const leader = await ctxFor(f.leader.userId)

    expect(() => requireCan(leader, 'user.create')).toThrow(ForbiddenError)
    expect(can(leader, 'invitation.manage')).toBe(true)
  })

  it('alterar de novo a mesma capability atualiza a linha em vez de duplicar', async () => {
    await setCapabilityFor(admin, 'MEMBER', 'export.csv', false)

    expect(await overridesOf(f.tenant.id, 'MEMBER')).toEqual({ 'export.csv': false })
  })

  it('o ajuste de um tenant não vaza para outro', async () => {
    await setCapabilityFor(admin, 'MEMBER', 'export.csv', true)

    expect(await overridesOf(other.tenant.id, 'MEMBER')).toEqual({})
    expect(can(await ctxFor(other.members[0]!.userId), 'export.csv')).toBe(false)
  })

  it('o ajuste de um papel não vaza para outro papel', async () => {
    expect(await overridesOf(f.tenant.id, 'LEADER')).not.toHaveProperty('export.csv')
  })
})

describe('setCapabilityFor: validações', () => {
  it.each<Role>(['TENANT_ADMIN', 'SUPER_ADMIN'])('não altera permissões de %s', async (role) => {
    await expect(setCapabilityFor(admin, role as 'MEMBER', 'audit.read', false)).rejects.toThrow('administrador')

    expect(await overridesByTeamRole(f.tenant.id)).not.toHaveProperty(role)
  })

  it('recusa capability desconhecida', async () => {
    await expect(setCapabilityFor(admin, 'MEMBER', 'nao.existe' as 'export.csv', true)).rejects.toThrow('desconhecida')
  })

  it.each(nonDelegableCapabilities)('não delega %s a papéis do tenant', async (capability) => {
    await expect(setCapabilityFor(admin, 'LEADER', capability, true)).rejects.toThrow('delegada')

    expect(await overridesOf(f.tenant.id, 'LEADER')).not.toHaveProperty(capability)
  })

  it('exige permissions.manage de quem altera', async () => {
    await expect(setCapabilityFor(f.leader, 'MEMBER', 'export.csv', true)).rejects.toThrow(ForbiddenError)
  })
})

describe('overridesByRoleFor', () => {
  it('devolve os ajustes dos dois papéis editáveis, só para quem gerencia permissões', async () => {
    await setCapabilityFor(admin, 'LEADER', 'user.deactivate', true)

    const byRole = await overridesByRoleFor(admin)

    expect(byRole.LEADER).toMatchObject({ 'user.deactivate': true })
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
      await db.insert(roleCapabilities).values({ tenantId: g.tenant.id, role: 'LEADER', capability: 'audit.read', allowed: true })
      const leader = await ctxFor(g.leader.userId)

      expect(leader.capabilityOverrides).toEqual({ LEADER: { 'audit.read': true } })
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
        ['tenant.configure', 'team.manage', 'audit.read', 'pipeline.configure', 'export.csv'].map((capability) => ({ tenantId: g.tenant.id, role: 'LEADER' as const, capability, allowed: true })),
      )

      await db.execute(sql.raw(migration))

      expect(await overridesOf(g.tenant.id, 'LEADER')).toEqual({ 'export.csv': true })
    } finally {
      await g.cleanup()
    }
  })
})

describe('migração que passa os overrides para o papel de equipe', () => {
  it('converte TEAM_LEADER em LEADER, preserva MEMBER e descarta linha de admin', async () => {
    const g = await makeTenant(0)
    const migration = readFileSync(new URL('../../drizzle/0012_papel_de_equipe_nos_overrides.sql', import.meta.url), 'utf8')
    const rowsOf = (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) =>
      tx.select({ role: roleCapabilities.role, capability: roleCapabilities.capability, allowed: roleCapabilities.allowed }).from(roleCapabilities).where(eq(roleCapabilities.tenantId, g.tenant.id)).orderBy(asc(roleCapabilities.capability))
    let migrated: Awaited<ReturnType<typeof rowsOf>> = []
    try {
      // DDL é transacional: volta a coluna ao tipo antigo, roda a migração e desfaz tudo no fim.
      await expect(
        db.transaction(async (tx) => {
          await tx.execute(sql`ALTER TABLE role_capabilities ALTER COLUMN role TYPE role USING (CASE role::text WHEN 'LEADER' THEN 'TEAM_LEADER' ELSE role::text END)::role`)
          await tx.execute(sql`
            INSERT INTO role_capabilities (tenant_id, role, capability, allowed) VALUES
              (${g.tenant.id}, 'TEAM_LEADER', 'export.csv', true),
              (${g.tenant.id}, 'MEMBER', 'lead.import', true),
              (${g.tenant.id}, 'TENANT_ADMIN', 'user.read', false)`)

          await tx.execute(sql.raw(migration))

          migrated = await rowsOf(tx)
          tx.rollback()
        }),
      ).rejects.toThrow(TransactionRollbackError)

      expect(migrated).toEqual([
        { role: 'LEADER', capability: 'export.csv', allowed: true },
        { role: 'MEMBER', capability: 'lead.import', allowed: true },
      ])
    } finally {
      await g.cleanup()
    }
  })
})
