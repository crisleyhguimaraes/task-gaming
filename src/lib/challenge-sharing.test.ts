import { describe, expect, it } from 'vitest'
import type { TeamRole } from '#/lib/access'
import { cannotCompeteReason, nextSharedTeamIds, sharingLabel } from './challenge-sharing'

describe('nextSharedTeamIds', () => {
  it('mantém as vinculadas que a pessoa não gerencia, para o replace não tirá-las', () => {
    expect(nextSharedTeamIds(['x', 'b'], ['b', 'c'], ['b'])).toEqual(['x', 'b'])
  })

  it('tirar a marcação de uma equipe gerenciada a remove', () => {
    expect(nextSharedTeamIds(['x', 'b'], ['b', 'c'], [])).toEqual(['x'])
  })

  it('marcar uma equipe gerenciada nova a inclui', () => {
    expect(nextSharedTeamIds(['x'], ['b', 'c'], ['c'])).toEqual(['x', 'c'])
  })

  it('ignora marcação de equipe que a pessoa não gerencia', () => {
    expect(nextSharedTeamIds([], ['b'], ['z'])).toEqual([])
  })
})

describe('sharingLabel', () => {
  it('desafio só da equipe dona não tem etiqueta', () => {
    expect(sharingLabel({ tenantWide: false, sharedTeamCount: 0 })).toBeNull()
  })

  it('conta a dona junto das vinculadas', () => {
    expect(sharingLabel({ tenantWide: false, sharedTeamCount: 1 })).toBe('Compartilhado · 2 equipes')
    expect(sharingLabel({ tenantWide: false, sharedTeamCount: 3 })).toBe('Compartilhado · 4 equipes')
  })

  it('o tenant todo vale mais que a contagem', () => {
    expect(sharingLabel({ tenantWide: true, sharedTeamCount: 2 })).toBe('Toda a empresa')
  })
})

describe('cannotCompeteReason', () => {
  const role: TeamRole = 'MEMBER'

  it('admin sem equipe vê o desafio mas não compete', () => {
    expect(cannotCompeteReason({ role: 'TENANT_ADMIN', memberships: [] })).toBe('Administradores sem equipe veem o desafio, mas não competem. Entre em uma equipe para tentar.')
  })

  it('quem tem equipe fora do alcance do desafio é avisado disso', () => {
    expect(cannotCompeteReason({ role: 'MEMBER', memberships: [{ teamId: 'a', role }] })).toBe('Nenhuma das suas equipes participa deste desafio.')
    expect(cannotCompeteReason({ role: 'TENANT_ADMIN', memberships: [{ teamId: 'a', role }] })).toBe('Nenhuma das suas equipes participa deste desafio.')
  })
})
