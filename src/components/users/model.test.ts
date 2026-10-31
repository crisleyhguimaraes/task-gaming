import { describe, expect, it } from 'vitest'
import { ForbiddenError, requireCan } from '#/server/roles'
import type { AuthCtx } from '#/server/roles'
import { assertWithinScope } from '#/server/scope'
import type { UserRow } from './model'
import { canDeactivate, canRemoveFromTeam, readPlacement, teamRoleOf, teamsWhereCan, tenantRoleOf } from './model'

const ctx = (role: AuthCtx['role'], memberships: AuthCtx['memberships'], capabilityOverrides: AuthCtx['capabilityOverrides'] = {}): AuthCtx => ({
  userId: 'me',
  tenantId: 't',
  role,
  memberships,
  name: 'Eu',
  impersonatedBy: null,
  mustChangePassword: false,
  capabilityOverrides,
})

const link = (teamId: string, role: 'LEADER' | 'MEMBER') => ({ teamId, teamName: teamId, role })

const person = (id: string, role: UserRow['role'], links: Array<[teamId: string, role: 'LEADER' | 'MEMBER']>): UserRow => ({
  id,
  name: id,
  email: `${id}@x.com`,
  role,
  banned: false,
  memberships: links.map(([teamId, teamRole]) => link(teamId, teamRole)),
})

const team = (id: string) => ({ id, name: id })

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

describe('canDeactivate', () => {
  const admin = ctx('TENANT_ADMIN', [])
  const delegated = { LEADER: { 'user.deactivate': true } } as const
  const leaderOfA = ctx('MEMBER', [{ teamId: 'A', role: 'LEADER' }, { teamId: 'B', role: 'MEMBER' }], delegated)

  it('admin desativa qualquer outra pessoa: membro, líder e outro admin', () => {
    expect(canDeactivate(admin, person('u', 'MEMBER', [['A', 'MEMBER']]))).toBe(true)
    expect(canDeactivate(admin, person('u', 'MEMBER', [['A', 'LEADER']]))).toBe(true)
    expect(canDeactivate(admin, person('u', 'TENANT_ADMIN', []))).toBe(true)
  })

  it('ninguém desativa a si mesmo, nem o admin', () => {
    expect(canDeactivate(admin, person('me', 'TENANT_ADMIN', []))).toBe(false)
    expect(canDeactivate(leaderOfA, person('me', 'MEMBER', [['A', 'MEMBER']]))).toBe(false)
  })

  it('líder com a capability desativa membro cujas equipes estão todas no seu escopo', () => {
    expect(canDeactivate(leaderOfA, person('u', 'MEMBER', [['A', 'MEMBER']]))).toBe(true)
  })

  it('líder não desativa quem também está numa equipe fora do seu escopo', () => {
    expect(canDeactivate(leaderOfA, person('u', 'MEMBER', [['A', 'MEMBER'], ['B', 'MEMBER']]))).toBe(false)
    expect(canDeactivate(leaderOfA, person('u', 'MEMBER', [['A', 'MEMBER'], ['C', 'MEMBER']]))).toBe(false)
  })

  it('líder não desativa outro líder, mesmo numa equipe do seu escopo', () => {
    expect(canDeactivate(leaderOfA, person('u', 'MEMBER', [['A', 'LEADER']]))).toBe(false)
  })

  it('líder não desativa admin', () => {
    expect(canDeactivate(leaderOfA, person('u', 'TENANT_ADMIN', [['A', 'MEMBER']]))).toBe(false)
  })

  it('líder não desativa quem não tem equipe: sem equipe não há escopo', () => {
    expect(canDeactivate(leaderOfA, person('u', 'MEMBER', []))).toBe(false)
  })

  it('sem a capability, o líder não desativa ninguém', () => {
    const leader = ctx('MEMBER', [{ teamId: 'A', role: 'LEADER' }])
    expect(canDeactivate(leader, person('u', 'MEMBER', [['A', 'MEMBER']]))).toBe(false)
  })
})

describe('canDeactivate espelha assertWithinScope do servidor', () => {
  const delegated = { LEADER: { 'user.deactivate': true } } as const
  const viewers = {
    admin: ctx('TENANT_ADMIN', []),
    'líder com a capability': ctx('MEMBER', [{ teamId: 'A', role: 'LEADER' }, { teamId: 'B', role: 'MEMBER' }], delegated),
    'líder de duas equipes com a capability': ctx('MEMBER', [{ teamId: 'A', role: 'LEADER' }, { teamId: 'B', role: 'LEADER' }], delegated),
    'líder sem a capability': ctx('MEMBER', [{ teamId: 'A', role: 'LEADER' }]),
    membro: ctx('MEMBER', [{ teamId: 'A', role: 'MEMBER' }]),
  }
  const targets = [
    person('em-A', 'MEMBER', [['A', 'MEMBER']]),
    person('em-B', 'MEMBER', [['B', 'MEMBER']]),
    person('em-A-e-B', 'MEMBER', [['A', 'MEMBER'], ['B', 'MEMBER']]),
    person('em-A-e-C', 'MEMBER', [['A', 'MEMBER'], ['C', 'MEMBER']]),
    person('líder-em-A', 'MEMBER', [['A', 'LEADER']]),
    person('líder-em-A-membro-em-B', 'MEMBER', [['A', 'LEADER'], ['B', 'MEMBER']]),
    person('admin-em-A', 'TENANT_ADMIN', [['A', 'MEMBER']]),
    person('sem-equipe', 'MEMBER', []),
  ]

  const refusedByServer = (me: AuthCtx, user: UserRow) => {
    try {
      requireCan(me, 'user.deactivate')
      const teamRole = user.memberships.some((m) => m.role === 'LEADER') ? 'LEADER' : 'MEMBER'
      assertWithinScope(me, { role: user.role, teamRole, teamIds: user.memberships.map((m) => m.teamId) }, 'user.deactivate')
      return false
    } catch (error) {
      if (error instanceof ForbiddenError) return true
      throw error
    }
  }

  for (const [viewerName, me] of Object.entries(viewers)) {
    for (const target of targets) {
      it(`${viewerName} × ${target.id}`, () => {
        expect(canDeactivate(me, target)).toBe(!refusedByServer(me, target))
      })
    }
  }
})

describe('tenantRoleOf e teamRoleOf', () => {
  it('só TENANT_ADMIN vira admin; qualquer outro valor, inclusive SUPER_ADMIN, vira membro', () => {
    expect(tenantRoleOf('TENANT_ADMIN')).toBe('TENANT_ADMIN')
    expect(tenantRoleOf('SUPER_ADMIN')).toBe('MEMBER')
    expect(tenantRoleOf(null)).toBe('MEMBER')
  })

  it('só LEADER vira líder; qualquer outro valor vira membro', () => {
    expect(teamRoleOf('LEADER')).toBe('LEADER')
    expect(teamRoleOf('TENANT_ADMIN')).toBe('MEMBER')
    expect(teamRoleOf(undefined)).toBe('MEMBER')
  })
})

describe('readPlacement', () => {
  const form = (fields: Record<string, string>) => {
    const data = new FormData()
    for (const [key, value] of Object.entries(fields)) data.set(key, value)
    return data
  }

  it('com equipe, lê o papel de tenant e o da equipe', () => {
    expect(readPlacement(form({ teamId: 'A', role: 'TENANT_ADMIN', teamRole: 'LEADER' }))).toEqual({ teamId: 'A', role: 'TENANT_ADMIN', teamRole: 'LEADER' })
  })

  it('sem equipe, o papel de equipe enviado é descartado', () => {
    expect(readPlacement(form({ teamId: '', role: 'MEMBER', teamRole: 'LEADER' }))).toEqual({ teamId: null, role: 'MEMBER', teamRole: 'MEMBER' })
  })

  it('formulário vazio coloca a pessoa como membro sem equipe', () => {
    expect(readPlacement(form({}))).toEqual({ teamId: null, role: 'MEMBER', teamRole: 'MEMBER' })
  })

  it('papel de tenant inválido não escala privilégio', () => {
    expect(readPlacement(form({ teamId: 'A', role: 'SUPER_ADMIN' })).role).toBe('MEMBER')
  })
})

describe('teamsWhereCan', () => {
  const teams = [team('A'), team('B'), team('C')]
  const leaderOfA = ctx('MEMBER', [{ teamId: 'A', role: 'LEADER' }, { teamId: 'B', role: 'MEMBER' }])

  it('admin tem a capability em todas as equipes', () => {
    expect(teamsWhereCan(ctx('TENANT_ADMIN', []), teams, 'user.create')).toEqual(teams)
  })

  it('líder só nas equipes que lidera, enquanto a capability valer para líder', () => {
    expect(teamsWhereCan(leaderOfA, teams, 'user.create')).toEqual([team('A')])
  })

  it('capability tirada do líder pelo tenant esvazia a lista', () => {
    const revoked = ctx('MEMBER', leaderOfA.memberships, { LEADER: { 'invitation.manage': false } })
    expect(teamsWhereCan(revoked, teams, 'invitation.manage')).toEqual([])
  })

  it('team.link é só do admin, a menos que o tenant delegue ao líder', () => {
    expect(teamsWhereCan(leaderOfA, teams, 'team.link')).toEqual([])
    const delegated = ctx('MEMBER', leaderOfA.memberships, { LEADER: { 'team.link': true } })
    expect(teamsWhereCan(delegated, teams, 'team.link')).toEqual([team('A')])
  })

  it('membro comum não tem a capability em equipe alguma', () => {
    expect(teamsWhereCan(ctx('MEMBER', [{ teamId: 'A', role: 'MEMBER' }]), teams, 'user.create')).toEqual([])
  })
})
