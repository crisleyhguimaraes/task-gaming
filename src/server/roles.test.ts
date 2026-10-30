import { describe, expect, it } from 'vitest'
import type { Role } from '#/db/schema'
import { ForbiddenError, capabilities, can, defaultGrants, forbid, requireCan } from './roles'

const hierarchy: Array<Role> = ['MEMBER', 'TEAM_LEADER', 'TENANT_ADMIN', 'SUPER_ADMIN']
const as = (role: Role) => ({ role })

describe('capabilities', () => {
  it('cada papel superior herda tudo o que o inferior pode, exceto o que é só da plataforma', () => {
    for (const cap of capabilities.filter((c) => c !== 'tenant.manage')) {
      hierarchy.forEach((role, i) => {
        if (can(as(role), cap)) expect(hierarchy.slice(i).every((upper) => can(as(upper), cap)), `${cap} perdido acima de ${role}`).toBe(true)
      })
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

describe('ForbiddenError', () => {
  it('forbid lança ForbiddenError com a mensagem padrão', () => {
    expect(() => forbid()).toThrow(ForbiddenError)
    expect(() => forbid()).toThrow('Sem permissão')
  })

  it('requireCan nega com ForbiddenError, tipado para o middleware reconhecer', () => {
    expect(() => requireCan(as('MEMBER'), 'audit.read')).toThrow(ForbiddenError)
  })
})
