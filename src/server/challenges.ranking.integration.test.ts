import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { challengeDetailFor, challengeRanking, challengeTeamRanking } from './challenges.core'
import type { AuthCtx } from './roles'
import { attemptChallengeFor, finishTaskFor, validatePointsFor } from './tasks.core'
import { addChallenge, addTeam, addUser, joinTeam, makeTenant } from './test-fixtures'

type Fixture = Awaited<ReturnType<typeof makeTenant>>
type Team = Fixture['team']

let f: Fixture
let teamB: Team
let teamC: Team
let a1: AuthCtx
let a2: AuthCtx
let ab: AuthCtx
let b1: AuthCtx
let c1: AuthCtx
let admin: AuthCtx

const MS_PER_MINUTE = 60_000
const HOUR = 60
const T0 = Date.UTC(2026, 2, 10, 12)
let nextSlot = 0

/** Cada tentativa começa numa hora própria, para a ordem de conclusão ser a da chamada. */
async function attempt(me: AuthCtx, challengeId: string, teamId: string | undefined, minutes: number) {
  const start = new Date(T0 + nextSlot++ * HOUR * MS_PER_MINUTE)
  const created = await attemptChallengeFor(me, challengeId, teamId, start)
  await finishTaskFor(me, created.id, new Date(start.getTime() + minutes * MS_PER_MINUTE))
  return created.id
}

beforeAll(async () => {
  f = await makeTenant(0)
  ;[teamB, teamC] = [await addTeam(f, 'B'), await addTeam(f, 'C')]
  a1 = await addUser(f, { role: 'MEMBER', team: f.team })
  a2 = await addUser(f, { role: 'MEMBER', team: f.team })
  await addUser(f, { role: 'MEMBER', team: f.team })
  ab = await joinTeam(f, (await addUser(f, { role: 'MEMBER', team: f.team })).userId, teamB)
  b1 = await addUser(f, { role: 'MEMBER', team: teamB })
  c1 = await addUser(f, { role: 'MEMBER', team: teamC })
  await addUser(f, { role: 'MEMBER', team: teamC })
  admin = await addUser(f, { role: 'TENANT_ADMIN', team: null })
})
afterAll(async () => {
  await f.cleanup()
  await db.$client.end()
})

describe('rankings do desafio compartilhado', () => {
  let challengeId: string

  beforeAll(async () => {
    challengeId = (await addChallenge(f, { sharedWith: [teamB, teamC] })).id
    await attempt(a1, challengeId, undefined, 12)
    await attempt(a1, challengeId, undefined, 10)
    await attempt(a2, challengeId, undefined, 14)
    await attempt(ab, challengeId, f.team.id, 13)
    await attempt(ab, challengeId, teamB.id, 9)
    await attempt(b1, challengeId, undefined, 11)
    await attempt(c1, challengeId, undefined, 8)
  })

  it('individual: o melhor tempo válido de cada pessoa, o número de tentativas e a equipe da melhor', async () => {
    const rows = await challengeRanking(challengeId)

    expect(rows.map((r) => [r.userId, r.best, r.attempts, r.teamId])).toEqual([
      [c1.userId, 8 * 60, 1, teamC.id],
      [ab.userId, 9 * 60, 2, teamB.id],
      [a1.userId, 10 * 60, 2, f.team.id],
      [b1.userId, 11 * 60, 1, teamB.id],
      [a2.userId, 14 * 60, 1, f.team.id],
    ])
    expect(rows[1]).toMatchObject({ teamName: 'B' })
  })

  it('por equipe: a média do melhor tempo de cada participante, com participantes e % da equipe (A tem 5 membros e 3 participaram)', async () => {
    const rows = await challengeTeamRanking(challengeId)

    expect(rows.map((r) => [r.teamId, r.averageSeconds, r.participants, r.participationPct])).toEqual([
      [teamC.id, 8 * 60, 1, 50],
      [teamB.id, ((11 + 9) / 2) * 60, 2, 100],
      [f.team.id, ((10 + 14 + 13) / 3) * 60, 3, 60],
    ])
  })

  it('quem tentou por duas equipes entra nas duas, cada uma com o melhor tempo feito por ela', async () => {
    const rows = await challengeTeamRanking(challengeId)

    const inA = rows.find((r) => r.teamId === f.team.id)!
    const inB = rows.find((r) => r.teamId === teamB.id)!
    expect([inA.participants, inB.participants]).toEqual([3, 2])
  })

  it('o detalhe devolve os dois rankings, ao admin sem equipe e a quem compete', async () => {
    const asAdmin = await challengeDetailFor(admin, challengeId)
    const asMember = await challengeDetailFor(ab, challengeId)

    expect(asAdmin.teamRanking.map((r) => r.teamId)).toEqual([teamC.id, teamB.id, f.team.id])
    expect(asAdmin.ranking).toHaveLength(5)
    expect(asMember.competingTeams.map((t) => t.id).sort()).toEqual([f.team.id, teamB.id].sort())
    expect(asAdmin.competingTeams).toEqual([])
    expect(asMember.sharedTeams.map((t) => t.name)).toEqual(['B', 'C'])
  })

  it('a equipe é a da tentativa, não o vínculo de hoje: sair da equipe não muda o ranking dela', async () => {
    const moved = await addUser(f, { role: 'MEMBER', team: teamC })
    const c = await addChallenge(f, { tenantWide: true })
    await attempt(moved, c.id, undefined, 20)
    await joinTeam(f, moved.userId, f.team)

    const [row] = await challengeTeamRanking(c.id)

    expect(row).toMatchObject({ teamId: teamC.id, participants: 1 })
  })
})

describe('tentativa retida e rejeitada fora dos rankings', () => {
  it('só entra depois de aprovada; rejeitada nunca entra', async () => {
    const c = await addChallenge(f, { sharedWith: [teamB] })
    await attempt(b1, c.id, undefined, 20)
    const held = await attempt(await addUser(f, { role: 'MEMBER', team: teamB }), c.id, undefined, 3)
    const rejected = await attempt(await addUser(f, { role: 'MEMBER', team: teamB }), c.id, undefined, 3)

    expect((await challengeRanking(c.id)).map((r) => r.best)).toEqual([20 * 60])
    expect(await challengeTeamRanking(c.id)).toMatchObject([{ participants: 1, averageSeconds: 20 * 60 }])

    await validatePointsFor(admin, held, true)
    await validatePointsFor(admin, rejected, false)

    expect((await challengeRanking(c.id)).map((r) => r.best)).toEqual([3 * 60, 20 * 60])
    expect(await challengeTeamRanking(c.id)).toMatchObject([{ participants: 2, averageSeconds: 11.5 * 60 }])
  })
})

describe('empate entre equipes', () => {
  it('na mesma média e com o mesmo número de participantes, vence quem fechou o resultado primeiro, e só depois o nome', async () => {
    const [zeta, alfa] = [await addTeam(f, 'Zeta'), await addTeam(f, 'Alfa')]
    const c = await addChallenge(f, { sharedWith: [zeta, alfa] })
    await attempt(await addUser(f, { role: 'MEMBER', team: zeta }), c.id, undefined, 15)
    await attempt(await addUser(f, { role: 'MEMBER', team: alfa }), c.id, undefined, 15)

    expect((await challengeTeamRanking(c.id)).map((r) => r.teamName)).toEqual(['Zeta', 'Alfa'])
  })

  it('mais participantes vence na mesma média', async () => {
    const [few, many] = [await addTeam(f, 'Poucos'), await addTeam(f, 'Muitos')]
    const c = await addChallenge(f, { sharedWith: [few, many] })
    await attempt(await addUser(f, { role: 'MEMBER', team: few }), c.id, undefined, 15)
    await attempt(await addUser(f, { role: 'MEMBER', team: many }), c.id, undefined, 10)
    await attempt(await addUser(f, { role: 'MEMBER', team: many }), c.id, undefined, 20)

    expect((await challengeTeamRanking(c.id)).map((r) => [r.teamName, r.averageSeconds, r.participants])).toEqual([['Muitos', 15 * 60, 2], ['Poucos', 15 * 60, 1]])
  })
})
