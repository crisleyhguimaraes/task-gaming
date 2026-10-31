import { describe, expect, it } from 'vitest'
import type { Role, TeamRole } from '#/lib/access'
import type { AuthCtx } from '#/server/roles'
import { shareableTeams } from './model'

const [A, B, C] = ['team-a', 'team-b', 'team-c'].map((id) => ({ id, name: id }))
const all = [A!, B!, C!]

const person = (role: Role, memberships: Array<[string, TeamRole]>, capabilityOverrides: AuthCtx['capabilityOverrides'] = {}) => ({
  role,
  memberships: memberships.map(([teamId, teamRole]) => ({ teamId, role: teamRole })),
  capabilityOverrides,
})

describe('shareableTeams', () => {
  it('admin oferece todas as equipes, menos a dona', () => {
    expect(shareableTeams(person('TENANT_ADMIN', []), all, A!.id)).toEqual([B, C])
  })

  it('líder oferece só as que lidera, menos a dona', () => {
    const leader = person('MEMBER', [[A!.id, 'LEADER'], [B!.id, 'LEADER'], [C!.id, 'MEMBER']])
    expect(shareableTeams(leader, all, A!.id)).toEqual([B])
  })

  it('líder sem a capability nas equipes não oferece nenhuma', () => {
    const leader = person('MEMBER', [[A!.id, 'LEADER'], [B!.id, 'LEADER']], { LEADER: { 'challenge.share': false } })
    expect(shareableTeams(leader, all, C!.id)).toEqual([])
  })

  it('membro com a capability delegada não oferece equipe que não gerencia', () => {
    const member = person('MEMBER', [[A!.id, 'MEMBER'], [B!.id, 'MEMBER']], { MEMBER: { 'challenge.share': true } })
    expect(shareableTeams(member, all, C!.id)).toEqual([])
  })
})
