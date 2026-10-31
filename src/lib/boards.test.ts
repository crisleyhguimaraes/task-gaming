import { describe, expect, it } from 'vitest'
import type { Role, TeamRole } from '#/lib/access'
import type { AuthCtx } from '#/server/roles'
import { canManageBoard } from './boards'

const A = 'team-a'
const B = 'team-b'

const person = (role: Role, memberships: Array<[string, TeamRole]>, capabilityOverrides: AuthCtx['capabilityOverrides'] = {}) => ({
  role,
  memberships: memberships.map(([teamId, teamRole]) => ({ teamId, role: teamRole })),
  capabilityOverrides,
})

describe('canManageBoard', () => {
  it('admin gerencia qualquer board, inclusive o sem vínculo', () => {
    expect(canManageBoard(person('TENANT_ADMIN', []), [])).toBe(true)
    expect(canManageBoard(person('TENANT_ADMIN', []), [A, B])).toBe(true)
  })

  it('líder gerencia o board vinculado só a equipes que ele lidera', () => {
    expect(canManageBoard(person('MEMBER', [[A, 'LEADER']]), [A])).toBe(true)
    expect(canManageBoard(person('MEMBER', [[A, 'LEADER'], [B, 'LEADER']]), [A, B])).toBe(true)
  })

  it('board compartilhado com equipe que ele não lidera é só do admin', () => {
    expect(canManageBoard(person('MEMBER', [[A, 'LEADER']]), [A, B])).toBe(false)
    expect(canManageBoard(person('MEMBER', [[A, 'LEADER'], [B, 'MEMBER']]), [A, B])).toBe(false)
  })

  it('board sem vínculo é só do admin', () => {
    expect(canManageBoard(person('MEMBER', [[A, 'LEADER']]), [])).toBe(false)
  })

  it('membro comum não gerencia, mesmo no board da própria equipe', () => {
    expect(canManageBoard(person('MEMBER', [[A, 'MEMBER']]), [A])).toBe(false)
  })

  it('o ajuste do tenant que tira board.manage do líder vale', () => {
    expect(canManageBoard(person('MEMBER', [[A, 'LEADER']], { LEADER: { 'board.manage': false } }), [A])).toBe(false)
  })
})
