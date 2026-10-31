import { describe, expect, it } from 'vitest'
import type { Role } from '#/db/schema'
import { ForbiddenError, capabilities, can, defaultGrants, forbid, nonDelegableCapabilities, requireCan } from './roles'

const hierarchy: Array<Role> = ['MEMBER', 'TEAM_LEADER', 'TENANT_ADMIN', 'SUPER_ADMIN']
const as = (role: Role) => ({ role })

describe('capabilities', () => {
  it('quem pode uma capability forma o topo da hierarquia: cada papel superior herda o que o inferior pode', () => {
    for (const cap of capabilities) {
      const granted = hierarchy.filter((role) => can(as(role), cap))

      expect(granted, cap).toEqual(hierarchy.slice(hierarchy.length - granted.length))
    }
  })

  it('criar tenants é exclusivo do SUPER_ADMIN', () => {
    expect(hierarchy.filter((r) => can(as(r), 'tenant.manage'))).toEqual(['SUPER_ADMIN'])
  })

  it('auditoria e gestão de equipes são de admin; líder gerencia usuários da equipe mas não altera papéis', () => {
    expect(can(as('TEAM_LEADER'), 'audit.read')).toBe(false)
    expect(can(as('TENANT_ADMIN'), 'audit.read')).toBe(true)
    expect(can(as('TEAM_LEADER'), 'team.manage')).toBe(false)
    expect(can(as('TEAM_LEADER'), 'user.create')).toBe(true)
    expect(can(as('TEAM_LEADER'), 'invitation.manage')).toBe(true)
    expect(can(as('TEAM_LEADER'), 'user.update')).toBe(false)
  })

  it('membro comum não tem nenhuma capability de gestão', () => {
    const memberCaps = capabilities.filter((c) => can(as('MEMBER'), c))
    expect(memberCaps.sort()).toEqual(['lead.write', 'opportunity.write'])
  })

  it('toda capability tem ao menos um papel concedido', () => {
    for (const cap of capabilities) expect(defaultGrants[cap].length, cap).toBeGreaterThan(0)
  })

  it('requireCan lança "Sem permissão" quando o papel não tem a capability', () => {
    expect(() => requireCan(as('MEMBER'), 'audit.read')).toThrow('Sem permissão')
    expect(() => requireCan(as('TENANT_ADMIN'), 'audit.read')).not.toThrow()
  })
})

describe('overrides por tenant', () => {
  it('sem override vale o padrão de fábrica', () => {
    expect(can({ role: 'MEMBER', capabilityOverrides: {} }, 'export.csv')).toBe(false)
    expect(can({ role: 'TEAM_LEADER', capabilityOverrides: {} }, 'export.csv')).toBe(true)
  })

  it('override concede o que o padrão nega', () => {
    expect(can({ role: 'MEMBER', capabilityOverrides: { 'export.csv': true } }, 'export.csv')).toBe(true)
  })

  it('override revoga o que o padrão concede, e só a capability citada', () => {
    const leader = { role: 'TEAM_LEADER', capabilityOverrides: { 'user.create': false } } as const

    expect(can(leader, 'user.create')).toBe(false)
    expect(can(leader, 'invitation.manage')).toBe(true)
  })
})

describe('capabilities não delegáveis', () => {
  it.each(nonDelegableCapabilities)('override de %s é ignorado, mesmo gravado: vale só o padrão de fábrica', (capability) => {
    for (const role of ['TEAM_LEADER', 'MEMBER'] as const) {
      expect(can({ role, capabilityOverrides: { [capability]: true } }, capability)).toBe(can(as(role), capability))
      expect(can({ role, capabilityOverrides: { [capability]: false } }, capability)).toBe(can(as(role), capability))
    }
  })

  it('cobrem tudo o que vale para o tenant inteiro', () => {
    expect([...nonDelegableCapabilities].sort()).toEqual(['audit.read', 'permissions.manage', 'pipeline.configure', 'team.manage', 'tenant.configure', 'tenant.manage'])
  })
})

describe('ForbiddenError', () => {
  it('forbid lança ForbiddenError com a mensagem padrão', () => {
    expect(() => forbid()).toThrow(ForbiddenError)
    expect(() => forbid()).toThrow('Sem permissão')
  })

  it('requireCan nega com ForbiddenError, tipado para o middleware reconhecer', () => {
    expect(() => requireCan(as('MEMBER'), 'audit.read')).toThrow(ForbiddenError)
  })
})
