import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { eq } from 'drizzle-orm'
import { challenges, taskTimeLogs, tasks } from '#/db/schema'
import type { AuthCtx } from './roles'
import { attentionCount, heroStats, poolOf, ranking, streak, teamFeed, teamPageFor } from './stats'
import { startTaskFor, finishTaskFor, validatePointsFor } from './tasks.core'
import { addMember, removeMember } from './team-members.core'
import { addAdmin, addTeam, addUser, joinTeam, makeTenant } from './test-fixtures'

let f: Awaited<ReturnType<typeof makeTenant>>

const seed = (teamId: string, patch: Partial<typeof tasks.$inferInsert>) =>
  db.insert(tasks).values({ tenantId: f.tenant.id, teamId, createdById: f.leader.userId, title: 'T', basePoints: 10, estimatedSeconds: 600, ...patch })

beforeAll(async () => {
  f = await makeTenant(1)
  const teamB = await addTeam(f, 'B')
  await seed(f.team.id, {})
  await seed(f.team.id, { status: 'finished', needsValidation: true })
  await seed(teamB.id, { status: 'finished', needsValidation: true })
  await seed(teamB.id, { status: 'finished', needsValidation: true })
})
afterAll(async () => {
  await f.cleanup()
  await db.$client.end()
})

describe('attentionCount', () => {
  it('líder conta o pool e as validações da própria equipe', async () => {
    expect(await attentionCount(f.leader)).toEqual({ pool: 1, validation: 1 })
  })

  it('membro conta o pool e nenhuma validação', async () => {
    expect(await attentionCount(f.members[0]!)).toEqual({ pool: 1, validation: 0 })
  })

  it('admin conta as validações do tenant inteiro', async () => {
    const admin = await addAdmin(f)

    expect((await attentionCount(admin)).validation).toBe(3)
  })

  it('líder sem equipe não conta nada, sem erro', async () => {
    const teamlessLeader = await addUser(f, { role: 'MEMBER', team: null, teamRole: 'LEADER' })

    expect(await attentionCount(teamlessLeader)).toEqual({ pool: 0, validation: 0 })
  })
})

describe('ranking', () => {
  const TZ = 'America/Sao_Paulo'
  const userIds = async (me: AuthCtx, teamId?: string) => (await ranking(me, 'all', TZ, teamId)).map((r) => r.userId)

  it('quem não tem equipe não enxerga o ranking do tenant', async () => {
    const teamless = await addUser(f, { role: 'MEMBER', team: null })

    expect(await userIds(teamless)).toEqual([])
  })

  it('membro vê só a própria equipe e admin vê o tenant, com ou sem filtro de equipe', async () => {
    const teamB = await addTeam(f)
    const inB = await addUser(f, { role: 'MEMBER', team: teamB })
    const admin = await addUser(f, { role: 'TENANT_ADMIN', team: null })

    expect(await userIds(f.members[0]!)).toEqual(expect.arrayContaining([f.leader.userId, f.members[0]!.userId]))
    expect(await userIds(f.members[0]!)).not.toContain(inB.userId)
    expect(await userIds(admin)).toContain(inB.userId)
    expect(await userIds(admin, teamB.id)).toEqual([inB.userId])
  })
})

describe('tarefa com pontos rejeitados', () => {
  const TZ = 'America/Sao_Paulo'
  const FAST_FINISH_MS = 60_000

  async function rejectedBy(owner: AuthCtx) {
    const [task] = await seed(f.team.id, { assignedToId: owner.userId, estimatedSeconds: 1800 }).returning()
    const startedAt = new Date()
    await startTaskFor(owner, task!.id, startedAt)
    await finishTaskFor(owner, task!.id, new Date(startedAt.getTime() + FAST_FINISH_MS))
    await validatePointsFor(f.leader, task!.id, false)
  }

  it('não vale como dia de sequência', async () => {
    const owner = await addUser(f, { role: 'MEMBER', team: f.team })
    await rejectedBy(owner)

    expect(await streak(owner.userId, TZ)).toBe(0)
  })

  it('não entra no ritmo nem no foco', async () => {
    const owner = await addUser(f, { role: 'MEMBER', team: f.team })
    await rejectedBy(owner)

    expect((await heroStats(owner.userId)).total).toBe(0)
  })

  it('não conta como concluída no ranking', async () => {
    const owner = await addUser(f, { role: 'MEMBER', team: f.team })
    await rejectedBy(owner)

    const row = (await ranking(f.leader, 'all', TZ, f.team.id)).find((r) => r.userId === owner.userId)
    expect(row).toMatchObject({ points: 0, finished: 0 })
  })
})

describe('várias equipes: pool, sino, ranking e feed', () => {
  const TZ = 'America/Sao_Paulo'
  let g: Awaited<ReturnType<typeof makeTenant>>
  let outsiders: Awaited<ReturnType<typeof makeTenant>>
  let teamX: { id: string }
  let teamY: { id: string }
  let teamZ: { id: string }
  let leaderOfXMemberOfY: AuthCtx

  const put = (teamId: string, patch: Partial<typeof tasks.$inferInsert>) =>
    db.insert(tasks).values({ tenantId: g.tenant.id, teamId, createdById: g.leader.userId, title: 'T', basePoints: 10, estimatedSeconds: 600, ...patch }).returning().then(([t]) => t!)
  const earn = (teamId: string, userId: string, points: number) =>
    put(teamId, { assignedToId: userId, status: 'finished', needsValidation: false, finishedAt: new Date(), awardedPoints: points, movingSeconds: 60 })

  const createChallenge = async (teamId: string) => {
    const [c] = await db.insert(challenges).values({ tenantId: g.tenant.id, teamId, title: 'D', estimatedSeconds: 600 }).returning()
    return c!
  }

  beforeAll(async () => {
    g = await makeTenant(0)
    outsiders = await makeTenant(0)
    teamX = g.team
    teamY = await addTeam(g, 'Y')
    teamZ = await addTeam(g, 'Z')
    leaderOfXMemberOfY = await joinTeam(g, (await addUser(g, { role: 'MEMBER', team: teamX, teamRole: 'LEADER' })).userId, teamY, 'MEMBER')
    await put(teamX.id, { title: 'pool X' })
    await put(teamY.id, { title: 'pool Y' })
    await put(teamZ.id, { title: 'pool Z' })
    await put(teamX.id, { title: 'com dono', assignedToId: g.leader.userId })
    await put(teamX.id, { title: 'de desafio', challengeId: (await createChallenge(teamX.id)).id })
    await put(teamX.id, { title: 'validar X', status: 'finished', needsValidation: true, assignedToId: g.leader.userId })
    await put(teamY.id, { title: 'validar Y', status: 'finished', needsValidation: true, assignedToId: g.leader.userId })
  })
  afterAll(async () => {
    await g.cleanup()
    await outsiders.cleanup()
  })

  describe('pool e sino', () => {
    it('o pool junta as tarefas livres de todas as minhas equipes, cada uma com o nome da equipe', async () => {
      const pool = await poolOf(leaderOfXMemberOfY)

      expect(pool.map((t) => [t.title, t.teamName]).sort()).toEqual([['pool X', 'Time'], ['pool Y', 'Y']])
    })

    it('o sino conta o pool de todas as minhas equipes e a validação só das que eu gerencio', async () => {
      expect(await attentionCount(leaderOfXMemberOfY)).toEqual({ pool: 2, validation: 1 })
    })

    it('membro comum conta o pool e nenhuma validação', async () => {
      const member = await joinTeam(g, (await addUser(g, { role: 'MEMBER', team: teamX })).userId, teamY)

      expect(await attentionCount(member)).toEqual({ pool: 2, validation: 0 })
    })
  })

  describe('ranking por tasks.team_id', () => {
    const rowOf = async (me: AuthCtx, teamId: string, userId: string) =>
      (await ranking(me, 'all', TZ, teamId)).find((r) => r.userId === userId)

    it('pontos ganhos na equipe A continuam em A depois que a pessoa vai para B', async () => {
      const admin = await addUser(g, { role: 'TENANT_ADMIN', team: null })
      const movedA = await addTeam(g, 'A-origem')
      const movedB = await addTeam(g, 'B-destino')
      const mover = await addUser(g, { role: 'MEMBER', team: movedA })
      await earn(movedA.id, mover.userId, 30)
      await db.transaction(async (tx) => {
        await removeMember(tx, admin, { teamId: movedA.id, userId: mover.userId })
        await addMember(tx, admin, { teamId: movedB.id, userId: mover.userId })
      })
      await earn(movedB.id, mover.userId, 5)

      expect(await rowOf(admin, movedA.id, mover.userId)).toMatchObject({ points: 30, finished: 1, teamName: 'A-origem' })
      expect(await rowOf(admin, movedB.id, mover.userId)).toMatchObject({ points: 5, finished: 1, teamName: 'B-destino' })
    })

    it('a soma do ranking da equipe bate com os pontos das tarefas dela, ex-membros inclusos', async () => {
      const admin = await addUser(g, { role: 'TENANT_ADMIN', team: null })
      const team = await addTeam(g, 'Soma')
      const stays = await addUser(g, { role: 'MEMBER', team })
      const leaves = await addUser(g, { role: 'MEMBER', team })
      const idle = await addUser(g, { role: 'MEMBER', team })
      await earn(team.id, stays.userId, 20)
      await earn(team.id, leaves.userId, 15)
      await db.transaction((tx) => removeMember(tx, admin, { teamId: team.id, userId: leaves.userId }))

      const rows = await ranking(admin, 'all', TZ, team.id)

      expect(rows.map((r) => [r.userId, r.points])).toEqual([[stays.userId, 20], [leaves.userId, 15], [idle.userId, 0]])
      expect(rows.reduce((sum, r) => sum + r.points, 0)).toBe(35)
    })

    it('quem está em duas equipes aparece em cada uma só com os pontos dela', async () => {
      const both = await addUser(g, { role: 'MEMBER', team: teamX })
      await joinTeam(g, both.userId, teamY)
      await earn(teamX.id, both.userId, 7)
      await earn(teamY.id, both.userId, 11)

      expect(await rowOf(g.leader, teamX.id, both.userId)).toMatchObject({ points: 7 })
      expect(await rowOf(leaderOfXMemberOfY, teamY.id, both.userId)).toMatchObject({ points: 11 })
      expect((await ranking(leaderOfXMemberOfY, 'all', TZ)).filter((r) => r.userId === both.userId).map((r) => [r.teamId, r.points]).sort()).toEqual(
        [[teamX.id, 7], [teamY.id, 11]].sort(),
      )
    })

    it('equipe alheia dá vazio, e o ranking do tenant não vaza para outro tenant', async () => {
      expect(await ranking(leaderOfXMemberOfY, 'all', TZ, teamZ.id)).toEqual([])
      expect(await ranking(await addUser(g, { role: 'TENANT_ADMIN', team: null }), 'all', TZ, outsiders.team.id)).toEqual([])
    })
  })

  describe('feed da equipe', () => {
    it('junta as equipes pedidas, mostra validação e pausadas só das que eu gerencio e não vaza outro tenant', async () => {
      const runner = await addUser(g, { role: 'MEMBER', team: teamY })
      const running = await put(teamY.id, { title: 'rodando', assignedToId: runner.userId, status: 'in_progress' })
      await db.insert(taskTimeLogs).values({ taskId: running.id, userId: runner.userId, startedAt: new Date() })
      const mine = [teamX.id, teamY.id]

      const feed = await teamFeed(leaderOfXMemberOfY, mine)
      const leaked = await teamFeed(leaderOfXMemberOfY, [outsiders.team.id])

      expect(feed.activeNow.map((a) => a.title)).toContain('rodando')
      expect(feed.pendingValidation.map((p) => p.title)).toEqual(['validar X'])
      expect(feed.poolCount).toBe(2)
      expect(leaked).toEqual({ activeNow: [], paused: [], pendingValidation: [], poolCount: 0 })
      await db.update(tasks).set({ status: 'cancelled' }).where(eq(tasks.id, running.id))
    })
  })

  describe('página da equipe', () => {
    it('sem equipe pedida, quem integra várias vê todas as suas; com uma delas, só ela', async () => {
      const all = await teamPageFor(leaderOfXMemberOfY, { period: 'all' })
      const onlyY = await teamPageFor(leaderOfXMemberOfY, { period: 'all', teamId: teamY.id })

      expect(all.teams.map((t) => t.id).sort()).toEqual([teamX.id, teamY.id].sort())
      expect(all.feed?.poolCount).toBe(2)
      expect(onlyY.teamId).toBe(teamY.id)
      expect(onlyY.feed?.poolCount).toBe(1)
      expect(onlyY.canManage).toBe(false)
      expect((await teamPageFor(leaderOfXMemberOfY, { period: 'all', teamId: teamX.id })).canManage).toBe(true)
    })

    it('equipe alheia ou sem equipe dá vazio', async () => {
      const alien = await teamPageFor(leaderOfXMemberOfY, { period: 'all', teamId: teamZ.id })
      const teamless = await teamPageFor(await addUser(g, { role: 'MEMBER', team: null }), { period: 'all' })

      expect(alien).toMatchObject({ teamId: null, ranking: [], feed: null, canManage: false })
      expect(teamless).toMatchObject({ teams: [], teamId: null, ranking: [], feed: null, canManage: false })
    })

    it('admin pede qualquer equipe do tenant, nunca a de outro tenant', async () => {
      const admin = await addAdmin(g)

      expect((await teamPageFor(admin, { period: 'all', teamId: teamZ.id })).feed).toMatchObject({ poolCount: 1 })
      expect(await teamPageFor(admin, { period: 'all', teamId: outsiders.team.id })).toMatchObject({ ranking: [], feed: null })
    })
  })
})
