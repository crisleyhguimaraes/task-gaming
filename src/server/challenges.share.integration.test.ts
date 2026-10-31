import { asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { auditEvents, challengeTeams, challenges } from '#/db/schema'
import { challengeDetailFor, createChallengeFor, setChallengeTeamsFor } from './challenges.core'
import { ForbiddenError } from './roles'
import type { AuthCtx } from './roles'
import { attemptChallengeFor, cancelTaskFor, finishTaskFor } from './tasks.core'
import { addChallenge, addTeam, addUser, joinTeam, makeTenant } from './test-fixtures'

type Fixture = Awaited<ReturnType<typeof makeTenant>>

let f: Fixture
let other: Fixture
let teamB: Fixture['team']
let teamC: Fixture['team']
let admin: AuthCtx
let leaderOfAAndB: AuthCtx
let memberOfA: AuthCtx

const data = { title: 'Novo', basePoints: 50, estimatedMinutes: 10, scoredAttemptsPerDay: 1 }
const sharedIdsOf = async (challengeId: string) =>
  (await db.select().from(challengeTeams).where(eq(challengeTeams.challengeId, challengeId))).map((l) => l.teamId).sort()
const auditOf = (challengeId: string, action: 'challenge.teams_changed' | 'challenge.created') =>
  db.select().from(auditEvents).where(eq(auditEvents.entityId, challengeId)).orderBy(asc(auditEvents.createdAt), asc(auditEvents.id)).then((rows) => rows.filter((e) => e.action === action))
const sorted = (...ids: Array<string>) => [...ids].sort()

beforeAll(async () => {
  f = await makeTenant(0)
  other = await makeTenant(0)
  ;[teamB, teamC] = [await addTeam(f, 'B'), await addTeam(f, 'C')]
  admin = await addUser(f, { role: 'TENANT_ADMIN', team: f.team })
  leaderOfAAndB = await joinTeam(f, f.leader.userId, teamB, 'LEADER')
  memberOfA = await addUser(f, { role: 'MEMBER', team: f.team })
})
afterAll(async () => {
  await f.cleanup()
  await other.cleanup()
  await db.$client.end()
})

describe('criar desafio', () => {
  it('o membro da equipe cria o desafio dela (challenge.write é de todos)', async () => {
    const c = await createChallengeFor(memberOfA, { ...data, teamId: f.team.id })

    expect(c).toMatchObject({ teamId: f.team.id, tenantWide: false })
    expect(await sharedIdsOf(c.id)).toEqual([])
  })

  it('o ajuste do tenant que tira challenge.write do membro vale', async () => {
    const revoked = { ...memberOfA, capabilityOverrides: { MEMBER: { 'challenge.write': false } } }

    await expect(createChallengeFor(revoked, { ...data, teamId: f.team.id })).rejects.toThrow(ForbiddenError)
  })

  it('o líder cria já compartilhado com equipes que lidera; a auditoria guarda o alcance', async () => {
    const c = await createChallengeFor(leaderOfAAndB, { ...data, teamId: f.team.id, teamIds: [teamB.id] })

    expect(await sharedIdsOf(c.id)).toEqual([teamB.id])
    const [created] = await auditOf(c.id, 'challenge.created')
    expect(created!.meta).toMatchObject({ tenantWide: false, sharedTeamIds: teamB.id })
  })

  it('o líder não cria já compartilhado com equipe que não lidera, nem com o tenant todo; o membro não compartilha', async () => {
    await expect(createChallengeFor(leaderOfAAndB, { ...data, teamId: f.team.id, teamIds: [teamC.id] })).rejects.toThrow(ForbiddenError)
    await expect(createChallengeFor(leaderOfAAndB, { ...data, teamId: f.team.id, tenantWide: true })).rejects.toThrow(ForbiddenError)
    await expect(createChallengeFor(memberOfA, { ...data, teamId: f.team.id, teamIds: [f.team.id, teamB.id] })).rejects.toThrow(ForbiddenError)
  })

  it('o admin cria compartilhado com qualquer equipe e com o tenant todo', async () => {
    const c = await createChallengeFor(admin, { ...data, teamId: f.team.id, teamIds: [teamB.id, teamC.id, teamB.id], tenantWide: true })

    expect(c.tenantWide).toBe(true)
    expect(await sharedIdsOf(c.id)).toEqual(sorted(teamB.id, teamC.id))
  })

  it('equipe de outro tenant é recusada, e nada fica gravado', async () => {
    const before = await db.select().from(challenges).where(eq(challenges.tenantId, f.tenant.id))

    await expect(createChallengeFor(admin, { ...data, teamId: f.team.id, teamIds: [other.team.id] })).rejects.toThrow('Equipe não encontrada')

    expect(await db.select().from(challenges).where(eq(challenges.tenantId, f.tenant.id))).toHaveLength(before.length)
  })
})

describe('compartilhar um desafio existente', () => {
  it('o líder da dona inclui equipe que também lidera, e a auditoria traz quem entrou', async () => {
    const c = await addChallenge(f)

    const diff = await setChallengeTeamsFor(leaderOfAAndB, c.id, { teamIds: [teamB.id], tenantWide: false })

    expect(diff).toEqual({ added: [teamB.id], removed: [] })
    expect(await sharedIdsOf(c.id)).toEqual([teamB.id])
    const [event] = await auditOf(c.id, 'challenge.teams_changed')
    expect(event).toMatchObject({ actorId: leaderOfAAndB.userId, entityType: 'challenge', meta: { name: c.title, added: teamB.id, removed: '' } })
  })

  it('o líder da dona não inclui equipe que não lidera', async () => {
    const c = await addChallenge(f)

    await expect(setChallengeTeamsFor(leaderOfAAndB, c.id, { teamIds: [teamC.id], tenantWide: false })).rejects.toThrow(ForbiddenError)

    expect(await sharedIdsOf(c.id)).toEqual([])
  })

  it('o líder não tira do alcance a equipe que o admin incluiu e ele não lidera', async () => {
    const c = await addChallenge(f, { sharedWith: [teamC] })

    await expect(setChallengeTeamsFor(leaderOfAAndB, c.id, { teamIds: [], tenantWide: false })).rejects.toThrow(ForbiddenError)
    expect(await sharedIdsOf(c.id)).toEqual([teamC.id])

    const keeping = await setChallengeTeamsFor(leaderOfAAndB, c.id, { teamIds: [teamC.id, teamB.id], tenantWide: false })
    expect(keeping).toEqual({ added: [teamB.id], removed: [] })
  })

  it('só o admin compartilha com qualquer equipe ou liga e desliga o tenant todo', async () => {
    const c = await addChallenge(f)

    await expect(setChallengeTeamsFor(leaderOfAAndB, c.id, { teamIds: [], tenantWide: true })).rejects.toThrow(ForbiddenError)

    expect(await setChallengeTeamsFor(admin, c.id, { teamIds: [teamC.id], tenantWide: true })).toEqual({ added: [teamC.id], removed: [] })
    expect((await challengeDetailFor(admin, c.id)).tenantWide).toBe(true)
    expect(await setChallengeTeamsFor(admin, c.id, { teamIds: [teamC.id], tenantWide: false })).toEqual({ added: [], removed: [] })
    expect((await challengeDetailFor(admin, c.id)).tenantWide).toBe(false)
  })

  it('o diff vai para a auditoria com quem entrou, quem saiu e a mudança do tenant todo; sem mudança, nada é gravado', async () => {
    const c = await addChallenge(f, { sharedWith: [teamB] })

    await setChallengeTeamsFor(admin, c.id, { teamIds: [teamC.id], tenantWide: true })
    await setChallengeTeamsFor(admin, c.id, { teamIds: [teamC.id], tenantWide: true })

    const events = await auditOf(c.id, 'challenge.teams_changed')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ meta: { added: teamC.id, removed: teamB.id }, changes: { tenantWide: { from: false, to: true } } })
  })

  it('o líder de outra equipe e o membro da dona não compartilham', async () => {
    const c = await addChallenge(f, { team: teamC })

    await expect(setChallengeTeamsFor(leaderOfAAndB, c.id, { teamIds: [teamB.id], tenantWide: false })).rejects.toThrow(ForbiddenError)
    await expect(setChallengeTeamsFor(memberOfA, (await addChallenge(f)).id, { teamIds: [], tenantWide: true })).rejects.toThrow(ForbiddenError)
  })

  it('o ajuste do tenant que tira challenge.share do líder vale', async () => {
    const c = await addChallenge(f)
    const revoked = { ...leaderOfAAndB, capabilityOverrides: { LEADER: { 'challenge.share': false } } }

    await expect(setChallengeTeamsFor(revoked, c.id, { teamIds: [teamB.id], tenantWide: false })).rejects.toThrow(ForbiddenError)
  })

  it('equipe de outro tenant é recusada, e o desafio de outro tenant não existe', async () => {
    const c = await addChallenge(f)
    const foreign = await addChallenge(other)

    await expect(setChallengeTeamsFor(admin, c.id, { teamIds: [other.team.id], tenantWide: false })).rejects.toThrow('Equipe não encontrada')
    await expect(setChallengeTeamsFor(admin, foreign.id, { teamIds: [], tenantWide: true })).rejects.toThrow('Desafio não encontrado')
    expect(await sharedIdsOf(c.id)).toEqual([])
  })

  it('a dona não entra na lista de vinculadas', async () => {
    const c = await addChallenge(f)

    expect(await setChallengeTeamsFor(admin, c.id, { teamIds: [f.team.id, teamB.id], tenantWide: false })).toEqual({ added: [teamB.id], removed: [] })
  })
})

describe('tirar do alcance uma equipe com tentativa em aberto', () => {
  const memberOfB = () => addUser(f, { role: 'MEMBER', team: teamB })

  it('é recusado com a contagem, e nada muda; concluída ou cancelada a tentativa, a remoção passa', async () => {
    const c = await addChallenge(f, { sharedWith: [teamB] })
    const [first, second] = [await memberOfB(), await memberOfB()]
    const attempt = await attemptChallengeFor(first, c.id)
    await attemptChallengeFor(second, c.id)

    await expect(setChallengeTeamsFor(admin, c.id, { teamIds: [], tenantWide: false })).rejects.toThrow('2 tentativas em aberto')
    expect(await sharedIdsOf(c.id)).toEqual([teamB.id])
    expect(await auditOf(c.id, 'challenge.teams_changed')).toHaveLength(0)

    await finishTaskFor(first, attempt.id)
    await expect(setChallengeTeamsFor(admin, c.id, { teamIds: [], tenantWide: false })).rejects.toThrow('1 tentativa em aberto')
    const open = await attemptChallengeFor(second, c.id)
    await cancelTaskFor(leaderOfAAndB, open.id)

    expect(await setChallengeTeamsFor(admin, c.id, { teamIds: [], tenantWide: false })).toEqual({ added: [], removed: [teamB.id] })
  })

  it('desligar o tenant todo com tentativa aberta de equipe fora da lista é recusado; com a equipe na lista, passa', async () => {
    const c = await addChallenge(f, { tenantWide: true })
    await attemptChallengeFor(await addUser(f, { role: 'MEMBER', team: teamC }), c.id)

    await expect(setChallengeTeamsFor(admin, c.id, { teamIds: [], tenantWide: false })).rejects.toThrow('1 tentativa em aberto')
    expect((await challengeDetailFor(admin, c.id)).tenantWide).toBe(true)

    await setChallengeTeamsFor(admin, c.id, { teamIds: [teamC.id], tenantWide: false })
    expect((await challengeDetailFor(admin, c.id)).tenantWide).toBe(false)
  })

  it('tentativa aberta da equipe dona não impede nada: ela nunca sai', async () => {
    const c = await addChallenge(f, { sharedWith: [teamB] })
    await attemptChallengeFor(memberOfA, c.id)

    await expect(setChallengeTeamsFor(admin, c.id, { teamIds: [], tenantWide: false })).resolves.toEqual({ added: [], removed: [teamB.id] })
  })
})
