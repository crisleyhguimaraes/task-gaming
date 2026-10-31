import { and, asc, eq, isNull } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { auditEvents, challenges, taskTimeLogs, tasks, teamMembers } from '#/db/schema'
import type { AuthCtx } from './roles'
import { addMember, removeMember, setRole, teamsOfUser } from './team-members.core'
import { updateUserCore } from './users.core'
import { addAdmin, addTeam, addUser, joinTeam, makeTenant } from './test-fixtures'

let f: Awaited<ReturnType<typeof makeTenant>>
let other: Awaited<ReturnType<typeof makeTenant>>
let admin: AuthCtx

beforeAll(async () => {
  f = await makeTenant(0)
  other = await makeTenant(0)
  admin = await addAdmin(f)
})
afterAll(async () => {
  await f.cleanup()
  await other.cleanup()
  await db.$client.end()
})

const add = (teamId: string, userId: string, role?: 'LEADER' | 'MEMBER') => db.transaction((tx) => addMember(tx, admin, { teamId, userId, role }))
const remove = (teamId: string, userId: string) => db.transaction((tx) => removeMember(tx, admin, { teamId, userId }))
const change = (teamId: string, userId: string, role: 'LEADER' | 'MEMBER') => db.transaction((tx) => setRole(tx, admin, { teamId, userId, role }))

const linksOf = (teamId: string, userId: string) =>
  db.select().from(teamMembers).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))

const eventsOf = (teamId: string) =>
  db.select().from(auditEvents).where(and(eq(auditEvents.tenantId, f.tenant.id), eq(auditEvents.entityType, 'team'), eq(auditEvents.entityId, teamId))).orderBy(asc(auditEvents.createdAt), asc(auditEvents.id))

const freshTeamAndUser = async (role: AuthCtx['role'] = 'MEMBER') => ({ team: await addTeam(f, 'Nova'), user: await addUser(f, { role, team: null }) })

describe('addMember', () => {
  it('cria o vínculo com o papel pedido (MEMBER por padrão) e audita na equipe', async () => {
    const { team, user } = await freshTeamAndUser()
    const candidate = await addUser(f, { role: 'MEMBER', team: null })

    await add(team.id, user.userId)
    await add(team.id, candidate.userId, 'LEADER')

    expect(await linksOf(team.id, user.userId)).toMatchObject([{ role: 'MEMBER', tenantId: f.tenant.id }])
    expect(await linksOf(team.id, candidate.userId)).toMatchObject([{ role: 'LEADER' }])
    expect(await eventsOf(team.id)).toMatchObject([
      { action: 'team.member_added', actorId: admin.userId, entityType: 'team', meta: { userId: user.userId, role: 'MEMBER' } },
      { action: 'team.member_added', meta: { userId: candidate.userId, role: 'LEADER' } },
    ])
  })

  it('repetir com o mesmo papel não duplica nem audita de novo', async () => {
    const { team, user } = await freshTeamAndUser()

    await add(team.id, user.userId)
    await add(team.id, user.userId)

    expect(await linksOf(team.id, user.userId)).toHaveLength(1)
    expect(await eventsOf(team.id)).toHaveLength(1)
  })

  it('quem já é membro com outro papel só muda de papel, e isso é auditado como troca', async () => {
    const { team, user } = await freshTeamAndUser()
    await add(team.id, user.userId, 'MEMBER')

    await add(team.id, user.userId, 'LEADER')

    expect(await linksOf(team.id, user.userId)).toMatchObject([{ role: 'LEADER' }])
    expect((await eventsOf(team.id)).map((e) => e.action)).toEqual(['team.member_added', 'team.member_role_changed'])
  })

  it('dois cadastros simultâneos do mesmo par resultam em um vínculo e uma auditoria', async () => {
    const { team, user } = await freshTeamAndUser()

    await Promise.all([add(team.id, user.userId), add(team.id, user.userId)])

    expect(await linksOf(team.id, user.userId)).toHaveLength(1)
    expect(await eventsOf(team.id)).toHaveLength(1)
  })

  it('recusa equipe de outro tenant, usuário de outro tenant e SUPER_ADMIN, sem gravar nada', async () => {
    const { team, user } = await freshTeamAndUser()
    const foreignUser = await addUser(other, { role: 'MEMBER', team: null })
    const root = await addUser(f, { role: 'SUPER_ADMIN', team: null })

    await expect(add(other.team.id, user.userId)).rejects.toThrow('Equipe não encontrada')
    await expect(add(team.id, foreignUser.userId)).rejects.toThrow('Usuário não encontrado')
    await expect(add(team.id, root.userId)).rejects.toThrow('Usuário não encontrado')

    expect(await linksOf(other.team.id, user.userId)).toHaveLength(0)
    expect(await linksOf(team.id, foreignUser.userId)).toHaveLength(0)
    expect(await linksOf(team.id, root.userId)).toHaveLength(0)
    expect(await eventsOf(team.id)).toHaveLength(0)
  })

  it('a falha desfaz a auditoria junto: sem transação concluída, nada fica', async () => {
    const { team, user } = await freshTeamAndUser()

    await expect(
      db.transaction(async (tx) => {
        await addMember(tx, admin, { teamId: team.id, userId: user.userId })
        throw new Error('falha depois do vínculo')
      }),
    ).rejects.toThrow('falha depois do vínculo')

    expect(await linksOf(team.id, user.userId)).toHaveLength(0)
    expect(await eventsOf(team.id)).toHaveLength(0)
  })
})

describe('removeMember', () => {
  it('apaga o vínculo e audita com o papel que a pessoa tinha', async () => {
    const { team, user } = await freshTeamAndUser()
    await add(team.id, user.userId, 'LEADER')

    await remove(team.id, user.userId)

    expect(await linksOf(team.id, user.userId)).toHaveLength(0)
    expect((await eventsOf(team.id)).at(-1)).toMatchObject({ action: 'team.member_removed', meta: { userId: user.userId, role: 'LEADER' } })
  })

  it('remover quem não é membro não faz nada nem audita', async () => {
    const { team, user } = await freshTeamAndUser()

    await remove(team.id, user.userId)

    expect(await eventsOf(team.id)).toHaveLength(0)
  })

  it('recusa equipe e usuário de outro tenant e SUPER_ADMIN', async () => {
    const { team } = await freshTeamAndUser()
    const foreignUser = await addUser(other, { role: 'MEMBER', team: other.team })
    const root = await addUser(f, { role: 'SUPER_ADMIN', team: null })

    await expect(remove(other.team.id, foreignUser.userId)).rejects.toThrow('Equipe não encontrada')
    await expect(remove(team.id, foreignUser.userId)).rejects.toThrow('Usuário não encontrado')
    await expect(remove(team.id, root.userId)).rejects.toThrow('Usuário não encontrado')

    expect(await linksOf(other.team.id, foreignUser.userId)).toHaveLength(1)
  })
})

describe('setRole', () => {
  it('troca o papel e audita com o antes e o depois', async () => {
    const { team, user } = await freshTeamAndUser()
    await add(team.id, user.userId, 'MEMBER')

    await change(team.id, user.userId, 'LEADER')

    expect(await linksOf(team.id, user.userId)).toMatchObject([{ role: 'LEADER' }])
    expect((await eventsOf(team.id)).at(-1)).toMatchObject({
      action: 'team.member_role_changed',
      meta: { userId: user.userId, role: 'LEADER' },
      changes: { role: { from: 'MEMBER', to: 'LEADER' } },
    })
  })

  it('o mesmo papel não faz nada nem audita', async () => {
    const { team, user } = await freshTeamAndUser()
    await add(team.id, user.userId, 'LEADER')

    await change(team.id, user.userId, 'LEADER')

    expect(await eventsOf(team.id)).toHaveLength(1)
  })

  it('recusa quem não é membro, equipe de outro tenant e SUPER_ADMIN', async () => {
    const { team, user } = await freshTeamAndUser()
    const root = await addUser(f, { role: 'SUPER_ADMIN', team: null })

    await expect(change(team.id, user.userId, 'LEADER')).rejects.toThrow('não é membro')
    await expect(change(other.team.id, user.userId, 'LEADER')).rejects.toThrow('Equipe não encontrada')
    await expect(change(team.id, root.userId, 'LEADER')).rejects.toThrow('Usuário não encontrado')
  })
})

describe('removeMember e o trabalho aberto da equipe', () => {
  const openTask = async (teamId: string, userId: string, patch: Partial<typeof tasks.$inferInsert> = {}) => {
    const [task] = await db
      .insert(tasks)
      .values({ tenantId: f.tenant.id, teamId, createdById: admin.userId, assignedToId: userId, status: 'in_progress', title: 'T', basePoints: 10, estimatedSeconds: 600, ...patch })
      .returning()
    await db.insert(taskTimeLogs).values({ taskId: task!.id, userId, startedAt: new Date(Date.now() - 60_000) })
    return task!
  }
  const taskNow = async (id: string) => (await db.select().from(tasks).where(eq(tasks.id, id)))[0]!
  const openLogs = (taskId: string) => db.select().from(taskTimeLogs).where(and(eq(taskTimeLogs.taskId, taskId), isNull(taskTimeLogs.stoppedAt)))

  it('devolve ao pool e fecha o log só das tarefas daquela equipe; as da outra ficam', async () => {
    const { team: teamA, user } = await freshTeamAndUser()
    const teamB = await addTeam(f, 'B')
    await add(teamA.id, user.userId)
    await add(teamB.id, user.userId)
    const inA = await openTask(teamA.id, user.userId)
    const inB = await openTask(teamB.id, user.userId, { status: 'paused' })

    await remove(teamA.id, user.userId)

    expect(await taskNow(inA.id)).toMatchObject({ status: 'pending', assignedToId: null })
    expect(await openLogs(inA.id)).toHaveLength(0)
    expect(await taskNow(inB.id)).toMatchObject({ status: 'paused', assignedToId: user.userId })
    expect(await openLogs(inB.id)).toHaveLength(1)
  })

  it('cancela a tentativa de desafio aberta, que o pool ignoraria e deixaria órfã', async () => {
    const { team, user } = await freshTeamAndUser()
    await add(team.id, user.userId)
    const [challenge] = await db
      .insert(challenges)
      .values({ tenantId: f.tenant.id, teamId: team.id, createdById: admin.userId, title: 'D', basePoints: 10, estimatedSeconds: 600 })
      .returning()
    const attempt = await openTask(team.id, user.userId, { challengeId: challenge!.id })

    await remove(team.id, user.userId)

    expect(await taskNow(attempt.id)).toMatchObject({ status: 'cancelled' })
    expect(await openLogs(attempt.id)).toHaveLength(0)
  })

  it('tarefa concluída da equipe continua com a pessoa', async () => {
    const { team, user } = await freshTeamAndUser()
    await add(team.id, user.userId)
    const done = await openTask(team.id, user.userId, { status: 'finished', awardedPoints: 10 })

    await remove(team.id, user.userId)

    expect(await taskNow(done.id)).toMatchObject({ status: 'finished', assignedToId: user.userId, awardedPoints: 10 })
  })

  it('updateUserCore ao mudar de equipe devolve só o trabalho da equipe antiga', async () => {
    const teamA = await addTeam(f, 'A')
    const teamB = await addTeam(f, 'B')
    const user = await addUser(f, { role: 'MEMBER', team: teamA })
    await joinTeam(f, user.userId, teamB)
    const inA = await openTask(teamA.id, user.userId)
    const inB = await openTask(teamB.id, user.userId, { status: 'paused' })

    await updateUserCore(admin, { userId: user.userId, teamId: null, role: 'MEMBER' })

    expect(await taskNow(inA.id)).toMatchObject({ status: 'pending', assignedToId: null })
    expect(await taskNow(inB.id)).toMatchObject({ status: 'paused', assignedToId: user.userId })
  })
})

describe('teamsOfUser', () => {
  it('lista as equipes da pessoa por nome, com o papel em cada uma', async () => {
    const [b, a] = [await addTeam(f, 'B-lista'), await addTeam(f, 'A-lista')]
    const user = await addUser(f, { role: 'MEMBER', team: null })
    await add(b.id, user.userId, 'LEADER')
    await add(a.id, user.userId)

    expect(await teamsOfUser(db, user.userId)).toEqual([
      { id: a.id, name: 'A-lista', role: 'MEMBER' },
      { id: b.id, name: 'B-lista', role: 'LEADER' },
    ])
  })
})
