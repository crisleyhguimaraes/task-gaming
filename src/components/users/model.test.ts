import { describe, expect, it } from 'vitest'
import type { AuthCtx } from '#/server/roles'
import { canRemoveFromTeam } from './model'

const ctx = (role: AuthCtx['role'], memberships: AuthCtx['memberships']): AuthCtx => ({
  userId: 'me',
  tenantId: 't',
  role,
  memberships,
  name: 'Eu',
  impersonatedBy: null,
  mustChangePassword: false,
  capabilityOverrides: {},
})

const link = (teamId: string, role: 'LEADER' | 'MEMBER') => ({ teamId, teamName: teamId, role })

describe('canRemoveFromTeam', () => {
  const leaderOfA = ctx('MEMBER', [{ teamId: 'A', role: 'LEADER' }, { teamId: 'B', role: 'MEMBER' }])

  it('líder remove membro da equipe que lidera, sem precisar de capability delegada', () => {
    expect(canRemoveFromTeam(leaderOfA, link('A', 'MEMBER'))).toBe(true)
  })

  it('líder não remove outro líder nem mexe em equipe que não lidera', () => {
    expect(canRemoveFromTeam(leaderOfA, link('A', 'LEADER'))).toBe(false)
    expect(canRemoveFromTeam(leaderOfA, link('B', 'MEMBER'))).toBe(false)
  })

  it('admin remove qualquer vínculo', () => {
    const admin = ctx('TENANT_ADMIN', [])
    expect(canRemoveFromTeam(admin, link('A', 'LEADER'))).toBe(true)
    expect(canRemoveFromTeam(admin, link('Z', 'MEMBER'))).toBe(true)
  })

  it('membro comum não remove ninguém', () => {
    expect(canRemoveFromTeam(ctx('MEMBER', [{ teamId: 'A', role: 'MEMBER' }]), link('A', 'MEMBER'))).toBe(false)
  })
})
