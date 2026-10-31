import { and, eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { challengeTeams, scoringRules, taskTimeLogs, tasks, teamMembers, teams } from '#/db/schema'
import { canSeeChallenge } from '#/lib/challenge'
import { challengeDetailFor, listChallengesFor, setChallengeTeamsFor } from './challenges.core'
import type { AuthCtx } from './roles'
import { FACTORY_RULES } from './scoring'
import { attemptChallengeFor, finishTaskFor, pauseTaskFor, startTaskFor } from './tasks.core'
import { addChallenge, addTeam, addUser, joinTeam, makeTenant } from './test-fixtures'

type Fixture = Awaited<ReturnType<typeof makeTenant>>

let f: Fixture
let other: Fixture
let teamB: Fixture['team']
let teamC: Fixture['team']
let admin: AuthCtx
let adminWithoutTeam: AuthCtx
const people = {} as Record<'a' | 'b' | 'c' | 'noTeam', AuthCtx>

const OPEN = ['pending', 'in_progress', 'paused'] as const
const idsOf = async (me: AuthCtx) => (await listChallengesFor(me)).map((c) => c.id)
const openAttemptsOf = (challengeId: string, extra = sql`true`) =>
  db.select().from(tasks).where(and(eq(tasks.challengeId, challengeId), inArray(tasks.status, [...OPEN]), extra))

beforeAll(async () => {
  f = await makeTenant(0)
  other = await makeTenant(1)
  ;[teamB, teamC] = [await addTeam(f, 'B'), await addTeam(f, 'C')]
  people.a = await addUser(f, { role: 'MEMBER', team: f.team })
  people.b = await addUser(f, { role: 'MEMBER', team: teamB })
  people.c = await addUser(f, { role: 'MEMBER', team: teamC })
  people.noTeam = await addUser(f, { role: 'MEMBER', team: null })
  admin = await addUser(f, { role: 'TENANT_ADMIN', team: f.team })
  adminWithoutTeam = await addUser(f, { role: 'TENANT_ADMIN', team: null })
})
afterAll(async () => {
  await f.cleanup()
  await other.cleanup()
  await db.$client.end()
})

describe('quem vê e quem tenta um desafio compartilhado', () => {
  it('equipe vinculada lista, vê o detalhe e tenta; a não vinculada não faz nenhuma das três', async () => {
    const c = await addChallenge(f, { sharedWith: [teamB] })

    expect(await idsOf(people.b)).toContain(c.id)
    expect(await challengeDetailFor(people.b, c.id)).toMatchObject({ id: c.id })
    expect(await attemptChallengeFor(people.b, c.id)).toMatchObject({ challengeId: c.id, status: 'in_progress' })

    expect(await idsOf(people.c)).not.toContain(c.id)
    await expect(challengeDetailFor(people.c, c.id)).rejects.toThrow('Desafio não encontrado')
    await expect(attemptChallengeFor(people.c, c.id)).rejects.toThrow('Desafio não encontrado')
  })

  it('a equipe dona vê e tenta o que compartilhou', async () => {
    const c = await addChallenge(f, { sharedWith: [teamB] })

    expect(await idsOf(people.a)).toContain(c.id)
    expect(await attemptChallengeFor(people.a, c.id)).toMatchObject({ teamId: f.team.id })
  })

  it('tenant_wide abre para qualquer equipe, mas não para quem não tem equipe', async () => {
    const c = await addChallenge(f, { tenantWide: true })

    expect(await idsOf(people.c)).toContain(c.id)
    expect(await attemptChallengeFor(people.c, c.id)).toMatchObject({ teamId: teamC.id })
    expect(await idsOf(people.noTeam)).not.toContain(c.id)
    await expect(attemptChallengeFor(people.noTeam, c.id)).rejects.toThrow('Desafio não encontrado')
  })

  it('admin vê todos, mas só tenta se tiver equipe que participe', async () => {
    const c = await addChallenge(f, { team: teamC })

    expect(await idsOf(admin)).toContain(c.id)
    expect(await idsOf(adminWithoutTeam)).toContain(c.id)
    expect(await challengeDetailFor(adminWithoutTeam, c.id)).toMatchObject({ id: c.id })
    await expect(attemptChallengeFor(adminWithoutTeam, c.id)).rejects.toThrow('Administradores sem equipe não competem')
    await expect(attemptChallengeFor(admin, c.id)).rejects.toThrow('Nenhuma das suas equipes participa')
    expect(await attemptChallengeFor(admin, (await addChallenge(f)).id)).toMatchObject({ teamId: f.team.id })
  })

  it('desafio arquivado não se tenta, nem pela equipe vinculada', async () => {
    const c = await addChallenge(f, { sharedWith: [teamB], archivedAt: new Date() })

    await expect(attemptChallengeFor(people.b, c.id)).rejects.toThrow('Desafio não encontrado')
  })

  it('o predicado SQL da listagem e o puro do detalhe concordam em todas as combinações', async () => {
    const scenarios = [
      await addChallenge(f),
      await addChallenge(f, { sharedWith: [teamB] }),
      await addChallenge(f, { team: teamC }),
      await addChallenge(f, { team: teamB, tenantWide: true }),
    ]
    const everyone = [...Object.values(people), admin, adminWithoutTeam]
    for (const me of everyone) {
      const listed = await idsOf(me)
      for (const c of scenarios) {
        const reach = { teamId: c.teamId, tenantWide: c.tenantWide, sharedTeamIds: (await challengeDetailFor(adminWithoutTeam, c.id)).sharedTeams.map((t) => t.id) }
        expect(listed.includes(c.id), `${me.userId} em ${c.title}`).toBe(canSeeChallenge(me, reach))
      }
    }
  })

  it('o outro tenant não vê nem tenta, nem com tenant_wide', async () => {
    const c = await addChallenge(f, { tenantWide: true, sharedWith: [teamB] })
    const outsider = other.members[0]!

    expect(await idsOf(outsider)).not.toContain(c.id)
    expect(await idsOf(await addUser(other, { role: 'TENANT_ADMIN', team: null }))).not.toContain(c.id)
    await expect(challengeDetailFor(outsider, c.id)).rejects.toThrow('Desafio não encontrado')
    await expect(attemptChallengeFor(outsider, c.id)).rejects.toThrow('Desafio não encontrado')
  })

  it('retomar a tentativa passa pelo mesmo acesso: sem alcance sobre o desafio, não retoma', async () => {
    const c = await addChallenge(f, { sharedWith: [teamB] })
    const attempt = await attemptChallengeFor(people.b, c.id)
    await pauseTaskFor(people.b, attempt.id)
    await db.delete(challengeTeams).where(eq(challengeTeams.challengeId, c.id))

    await expect(startTaskFor(people.b, attempt.id)).rejects.toThrow('Desafio não encontrado')
  })
})

describe('a equipe da tentativa', () => {
  it('grava a equipe pela qual a pessoa tentou, não a dona', async () => {
    const c = await addChallenge(f, { sharedWith: [teamB] })

    const attempt = await attemptChallengeFor(people.b, c.id)

    expect(attempt.teamId).toBe(teamB.id)
  })

  it('pessoa em duas equipes do alcance escolhe a equipe, e a escolha vale', async () => {
    const both = await joinTeam(f, (await addUser(f, { role: 'MEMBER', team: f.team })).userId, teamB)
    const c = await addChallenge(f, { sharedWith: [teamB] })

    await expect(attemptChallengeFor(both, c.id)).rejects.toThrow('Escolha a equipe')
    await expect(attemptChallengeFor(both, c.id, teamC.id)).rejects.toThrow('não participa')
    expect(await openAttemptsOf(c.id, eq(tasks.assignedToId, both.userId))).toHaveLength(0)

    const attempt = await attemptChallengeFor(both, c.id, teamB.id)
    expect(attempt.teamId).toBe(teamB.id)
  })

  it('pessoa em duas equipes, só uma no alcance, não precisa escolher', async () => {
    const both = await joinTeam(f, (await addUser(f, { role: 'MEMBER', team: teamB })).userId, teamC)
    const c = await addChallenge(f, { team: teamC })

    expect(await attemptChallengeFor(both, c.id)).toMatchObject({ teamId: teamC.id })
  })

  it('a regra do snapshot é a da equipe dona, não a da equipe pela qual tentou', async () => {
    const [owning, visiting] = [await addTeam(f), await addTeam(f)]
    const [ownersRule, visitorsRule] = await db
      .insert(scoringRules)
      .values([
        { ...FACTORY_RULES, tenantId: f.tenant.id, name: 'Da dona', paceBonusPct: 50 },
        { ...FACTORY_RULES, tenantId: f.tenant.id, name: 'Da visitante', paceBonusPct: 1 },
      ])
      .returning()
    await db.update(teams).set({ scoringRuleId: ownersRule!.id }).where(eq(teams.id, owning.id))
    await db.update(teams).set({ scoringRuleId: visitorsRule!.id }).where(eq(teams.id, visiting.id))
    const c = await addChallenge(f, { team: owning, sharedWith: [visiting] })
    const visitor = await addUser(f, { role: 'MEMBER', team: visiting })

    const attempt = await attemptChallengeFor(visitor, c.id)

    expect(attempt.teamId).toBe(visiting.id)
    expect(attempt.scoringSnapshot).toMatchObject({ ruleId: ownersRule!.id, paceBonusPct: 50 })
  })

  it('o vínculo real com a equipe continua exigido: ctx velho de quem saiu da equipe não cria tentativa', async () => {
    const stale = await addUser(f, { role: 'MEMBER', team: teamB })
    const c = await addChallenge(f, { sharedWith: [teamB] })
    await db.delete(teamMembers).where(and(eq(teamMembers.teamId, teamB.id), eq(teamMembers.userId, stale.userId)))

    await expect(attemptChallengeFor(stale, c.id)).rejects.toThrow('Tarefa não encontrada')

    expect(await db.select().from(tasks).where(and(eq(tasks.challengeId, c.id), eq(tasks.assignedToId, stale.userId)))).toHaveLength(0)
  })

  it('a tentativa conclui normalmente e conta para a equipe pela qual foi feita', async () => {
    const c = await addChallenge(f, { sharedWith: [teamB] })
    const t0 = new Date()
    const attempt = await attemptChallengeFor(people.b, c.id, undefined, t0)

    const summary = await finishTaskFor(people.b, attempt.id, new Date(t0.getTime() + 25 * 60_000))

    expect(summary).toMatchObject({ scored: true, finalPoints: 40 })
    const [row] = await db.select().from(tasks).where(eq(tasks.id, attempt.id))
    expect(row).toMatchObject({ teamId: teamB.id, status: 'finished' })
    expect(await db.select().from(taskTimeLogs).where(eq(taskTimeLogs.taskId, attempt.id))).toHaveLength(1)
  })
})

describe('concorrência', () => {
  const warmPool = () => Promise.all(Array.from({ length: 6 }, () => db.execute(sql`select 1`)))

  it('dois cliques da mesma pessoa escolhendo equipes diferentes geram uma única tentativa aberta', async () => {
    const both = await joinTeam(f, (await addUser(f, { role: 'MEMBER', team: f.team })).userId, teamB)
    const c = await addChallenge(f, { sharedWith: [teamB] })
    await warmPool()

    const results = await Promise.allSettled([attemptChallengeFor(both, c.id, f.team.id), attemptChallengeFor(both, c.id, teamB.id)])

    expect(results.filter((r) => r.status === 'fulfilled').length).toBeGreaterThan(0)
    expect(await openAttemptsOf(c.id)).toHaveLength(1)
  })

  it('tirar a equipe do compartilhamento ao mesmo tempo que ela inicia a tentativa nunca deixa tentativa viva de equipe removida', async () => {
    const ROUNDS = 8
    for (let round = 0; round < ROUNDS; round++) {
      const c = await addChallenge(f, { sharedWith: [teamB] })
      const member = await addUser(f, { role: 'MEMBER', team: teamB })
      await warmPool()

      await Promise.allSettled([attemptChallengeFor(member, c.id), setChallengeTeamsFor(admin, c.id, { teamIds: [], tenantWide: false })])

      const stillShared = (await challengeDetailFor(admin, c.id)).sharedTeams.some((t) => t.id === teamB.id)
      const liveFromB = await openAttemptsOf(c.id, eq(tasks.teamId, teamB.id))
      expect(liveFromB.length === 0 || stillShared, `rodada ${round}`).toBe(true)
    }
  })
})
