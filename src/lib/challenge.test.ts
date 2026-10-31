import { describe, expect, it } from 'vitest'
import type { Role, TeamRole } from '#/lib/access'
import { canSeeChallenge, chooseAttemptTeam, competingTeamIds, countAttempts, rankTeams } from './challenge'
import type { TeamBest } from './challenge'

const A = 'team-a'
const B = 'team-b'
const C = 'team-c'

const teamRole: TeamRole = 'MEMBER'
const person = (role: Role, teamIds: Array<string>) => ({ role, memberships: teamIds.map((teamId) => ({ teamId, role: teamRole })) })

const owned = { teamId: A, tenantWide: false, sharedTeamIds: [] as Array<string> }
const sharedWithB = { ...owned, sharedTeamIds: [B] }
const wide = { ...owned, tenantWide: true }

describe('competingTeamIds', () => {
  it('são as minhas equipes que estão no alcance: a dona e as vinculadas', () => {
    expect(competingTeamIds(person('MEMBER', [A, C]), sharedWithB)).toEqual([A])
    expect(competingTeamIds(person('MEMBER', [A, B, C]), sharedWithB)).toEqual([A, B])
  })

  it('tenant_wide leva todas as minhas equipes', () => {
    expect(competingTeamIds(person('MEMBER', [B, C]), wide)).toEqual([B, C])
  })

  it('quem não tem equipe no alcance não compete', () => {
    expect(competingTeamIds(person('MEMBER', [C]), sharedWithB)).toEqual([])
    expect(competingTeamIds(person('MEMBER', []), wide)).toEqual([])
  })
})

describe('canSeeChallenge', () => {
  it('admin vê tudo, mesmo sem equipe', () => {
    expect(canSeeChallenge(person('TENANT_ADMIN', []), owned)).toBe(true)
  })

  it('os demais veem se alguma equipe deles compete', () => {
    expect(canSeeChallenge(person('MEMBER', [B]), sharedWithB)).toBe(true)
    expect(canSeeChallenge(person('MEMBER', [C]), sharedWithB)).toBe(false)
    expect(canSeeChallenge(person('MEMBER', [C]), wide)).toBe(true)
  })
})

describe('chooseAttemptTeam', () => {
  it('uma candidata resolve sozinha', () => {
    expect(chooseAttemptTeam([A], undefined)).toBe(A)
  })

  it('mais de uma candidata exige escolha, e a escolha vale se for candidata', () => {
    expect(() => chooseAttemptTeam([A, B], undefined)).toThrow('Escolha a equipe')
    expect(chooseAttemptTeam([A, B], B)).toBe(B)
  })

  it('equipe pedida que não é candidata é recusada, mesmo havendo uma só', () => {
    expect(() => chooseAttemptTeam([A], C)).toThrow('não participa')
    expect(() => chooseAttemptTeam([A, B], C)).toThrow('não participa')
  })

  it('sem candidata não há tentativa', () => {
    expect(() => chooseAttemptTeam([], undefined)).toThrow('Nenhuma das suas equipes participa')
  })
})

const at = (minute: number) => new Date(Date.UTC(2026, 2, 10, 12, minute))
const best = (teamId: string, userId: string, seconds: number, minute: number): TeamBest => ({ teamId, teamName: `Equipe ${teamId}`, userId, seconds, finishedAt: at(minute) })
const members = (...entries: Array<[string, Array<string>]>) => new Map(entries.map(([teamId, ids]) => [teamId, new Set(ids)]))

describe('rankTeams', () => {
  it('a média do melhor tempo de cada participante manda, e a % é de membros atuais que participaram', () => {
    const rows = rankTeams(
      [best(A, 'a1', 600, 1), best(A, 'a2', 900, 2), best(B, 'b1', 600, 3), best(B, 'b2', 640, 4), best(B, 'b3', 700, 5)],
      members([A, ['a1', 'a2', 'a3', 'a4']], [B, ['b1', 'b2', 'b3']]),
    )

    expect(rows.map((r) => [r.teamId, r.averageSeconds, r.participants, r.participationPct])).toEqual([
      [B, 647, 3, 100],
      [A, 750, 2, 50],
    ])
  })

  it('equipe de um só participante compete com o tempo dele', () => {
    const rows = rankTeams([best(A, 'a1', 900, 1), best(B, 'b1', 600, 2)], members([A, ['a1', 'a2']], [B, ['b1']]))

    expect(rows.map((r) => [r.teamId, r.averageSeconds, r.participants, r.participationPct])).toEqual([
      [B, 600, 1, 100],
      [A, 900, 1, 50],
    ])
  })

  it('empate na média fica com a equipe de mais participantes', () => {
    const rows = rankTeams([best(A, 'a1', 750, 1), best(B, 'b1', 600, 2), best(B, 'b2', 900, 3)], members([A, ['a1']], [B, ['b1', 'b2']]))

    expect(rows.map((r) => r.teamId)).toEqual([B, A])
  })

  it('empate na média e nos participantes fica com quem fechou o resultado primeiro', () => {
    const rows = rankTeams(
      [best(A, 'a1', 600, 10), best(A, 'a2', 800, 30), best(B, 'b1', 700, 5), best(B, 'b2', 700, 20)],
      members([A, ['a1', 'a2']], [B, ['b1', 'b2']]),
    )

    expect(rows.map((r) => [r.teamId, r.reachedAt])).toEqual([[B, at(20)], [A, at(30)]])
  })

  it('empate em tudo cai no nome da equipe', () => {
    const rows = rankTeams(
      [{ ...best('z', 'z1', 600, 1), teamName: 'Zeta' }, { ...best('y', 'y1', 600, 1), teamName: 'Alfa' }],
      members(['z', ['z1']], ['y', ['y1']]),
    )

    expect(rows.map((r) => r.teamName)).toEqual(['Alfa', 'Zeta'])
  })

  it('a média é comparada sem arredondar: 1/3 de segundo decide', () => {
    const rows = rankTeams(
      [best(A, 'a1', 100, 1), best(A, 'a2', 100, 1), best(A, 'a3', 101, 1), best(B, 'b1', 100, 2), best(B, 'b2', 100, 2), best(B, 'b3', 100, 2)],
      members([A, ['a1', 'a2', 'a3']], [B, ['b1', 'b2', 'b3']]),
    )

    expect(rows.map((r) => r.teamId)).toEqual([B, A])
  })

  it('ex-membro conta no resultado da equipe, mas não na % de participação', () => {
    const [row] = rankTeams([best(A, 'a1', 600, 1), best(A, 'gone', 800, 2)], members([A, ['a1', 'a2']]))

    expect(row).toMatchObject({ participants: 2, averageSeconds: 700, participationPct: 50 })
  })

  it('equipe sem membros atuais tem 0% e sem tentativas não aparece', () => {
    expect(rankTeams([best(A, 'gone', 600, 1)], members())[0]!.participationPct).toBe(0)
    expect(rankTeams([], members([A, ['a1']]))).toEqual([])
  })
})

describe('countAttempts', () => {
  it('concorda com o número', () => {
    expect([1, 2].map(countAttempts)).toEqual(['1 tentativa', '2 tentativas'])
  })
})
