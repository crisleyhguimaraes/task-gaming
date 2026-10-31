import { describe, expect, it } from 'vitest'
import type { Role, TeamRole } from '#/lib/access'
import { displayRole, formatIsoDate, plural } from './format'

const person = (role: Role, memberships: Array<[string, TeamRole]> = []) => ({ role, memberships: memberships.map(([teamId, teamRole]) => ({ teamId, role: teamRole })) })

describe('displayRole', () => {
  it('admin mostra o rótulo do papel de tenant', () => {
    expect(displayRole(person('TENANT_ADMIN', [['a', 'MEMBER']]))).toBe('Gestor geral')
    expect(displayRole(person('SUPER_ADMIN'))).toBe('Super admin')
  })

  it('líder de ao menos uma equipe é líder, mesmo com users.role de membro', () => {
    expect(displayRole(person('MEMBER', [['a', 'MEMBER'], ['b', 'LEADER']]))).toBe('Líder de equipe')
  })

  it('quem só integra equipes, ou nenhuma, é membro', () => {
    expect(displayRole(person('MEMBER', [['a', 'MEMBER']]))).toBe('Membro')
    expect(displayRole(person('MEMBER'))).toBe('Membro')
  })
})

describe('plural', () => {
  it('um usa o singular', () => {
    expect(plural(1, 'tarefa', 'tarefas')).toBe('1 tarefa')
  })

  it('zero e mais de um usam o plural', () => {
    expect(plural(0, 'tarefa', 'tarefas')).toBe('0 tarefas')
    expect(plural(2, 'tarefa', 'tarefas')).toBe('2 tarefas')
  })
})

describe('formatIsoDate', () => {
  it('troca AAAA-MM-DD por DD/MM/AAAA', () => {
    expect(formatIsoDate('2026-11-04')).toBe('04/11/2026')
  })
})
