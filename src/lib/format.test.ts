import { describe, expect, it } from 'vitest'
import type { Role, TeamRole } from '#/lib/access'
import { displayRole } from './format'

const person = (role: Role, memberships: Array<[string, TeamRole]> = []) => ({ role, memberships: memberships.map(([teamId, teamRole]) => ({ teamId, role: teamRole })) })

describe('displayRole', () => {
  it('admin mostra o rótulo do papel de tenant', () => {
    expect(displayRole(person('TENANT_ADMIN', [['a', 'MEMBER']]))).toBe('Gestor geral')
    expect(displayRole(person('SUPER_ADMIN'))).toBe('Super admin')
  })

  it('líder de ao menos uma equipe é líder, mesmo com users.role de membro', () => {
    expect(displayRole(person('MEMBER', [['a', 'MEMBER'], ['b', 'LEADER']]))).toBe('Líder de equipe')
  })

  it('o papel legado de líder sem vínculo de líder não conta', () => {
    expect(displayRole(person('TEAM_LEADER', [['a', 'MEMBER']]))).toBe('Membro')
    expect(displayRole(person('TEAM_LEADER'))).toBe('Membro')
  })

  it('quem só integra equipes, ou nenhuma, é membro', () => {
    expect(displayRole(person('MEMBER', [['a', 'MEMBER']]))).toBe('Membro')
    expect(displayRole(person('MEMBER'))).toBe('Membro')
  })
})
