import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { auditEvents, tasks, users } from '#/db/schema'
import { archiveBoardFor, createBoardFor, unlinkTeamFromBoardFor } from './boards.core'
import type { AuthCtx } from './roles'
import { attemptChallengeFor, cancelTaskFor, createTaskFor, restoreTaskFor } from './tasks.core'
import { removeMember } from './team-members.core'
import { addAdmin, addChallenge, addTeam, addUser, joinTeam, makeTenant } from './test-fixtures'

let f: Awaited<ReturnType<typeof makeTenant>>
let other: Awaited<ReturnType<typeof makeTenant>>
let outsider: AuthCtx
let admin: AuthCtx

let sequence = 0
const boardFor = (teamIds: Array<string>) => createBoardFor(admin, { name: `Quadro de restauração ${++sequence}`, teamIds })
const taskOnBoard = (boardId: string) =>
  createTaskFor(f.leader, { title: 'Na board', basePoints: 10, estimatedMinutes: 10, teamId: f.team.id, assignedToId: null, boardId })

const newTask = async (patch: Partial<typeof tasks.$inferInsert> = {}) => {
  const [t] = await db
    .insert(tasks)
    .values({ tenantId: f.tenant.id, teamId: f.team.id, createdById: f.leader.userId, title: 'T', basePoints: 100, estimatedSeconds: 600, ...patch })
    .returning()
  return t!
}

const statusOf = async (id: string) => (await db.select().from(tasks).where(eq(tasks.id, id)))[0]!

beforeAll(async () => {
  f = await makeTenant(1)
  other = await makeTenant(0)
  outsider = other.leader
  admin = await addAdmin(f)
})
afterAll(async () => {
  await f.cleanup()
  await other.cleanup()
  await db.$client.end()
})

describe('restaurar tarefa', () => {
  it('cancelada volta a pendente com o mesmo responsável', async () => {
    const t = await newTask({ assignedToId: f.members[0]!.userId })
    await cancelTaskFor(f.leader, t.id)

    await restoreTaskFor(f.leader, t.id)

    expect(await statusOf(t.id)).toMatchObject({ status: 'pending', assignedToId: f.members[0]!.userId, awardedPoints: null })
  })

  it('audita a restauração com a mudança de status', async () => {
    const t = await newTask()
    await cancelTaskFor(f.leader, t.id)

    await restoreTaskFor(f.leader, t.id)

    const [e] = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, t.id), eq(auditEvents.action, 'task.restored')))
    expect(e).toMatchObject({ actorId: f.leader.userId, changes: { status: { from: 'cancelled', to: 'pending' } } })
  })

  it('só restaura tarefa cancelada', async () => {
    const t = await newTask()

    await expect(restoreTaskFor(f.leader, t.id)).rejects.toThrow('canceladas')
  })

  it('membro não restaura, nem a própria tarefa', async () => {
    const t = await newTask({ assignedToId: f.members[0]!.userId })
    await cancelTaskFor(f.leader, t.id)

    await expect(restoreTaskFor(f.members[0]!, t.id)).rejects.toThrow('Sem permissão')
    expect((await statusOf(t.id)).status).toBe('cancelled')
  })

  it('gestor de outro tenant não encontra a tarefa', async () => {
    const t = await newTask()
    await cancelTaskFor(f.leader, t.id)

    await expect(restoreTaskFor(outsider, t.id)).rejects.toThrow('Tarefa não encontrada')
  })
})

describe('restaurar tarefa: capability na equipe da tarefa', () => {
  it('quem lidera a equipe sem a capability não restaura só porque outra equipe, onde é membro, a libera', async () => {
    const memberOnly = await addTeam(f, 'Restaura como membro')
    const leaderOfA = await joinTeam(f, (await addUser(f, { role: 'MEMBER', team: f.team, teamRole: 'LEADER' })).userId, memberOnly)
    const me: AuthCtx = { ...leaderOfA, capabilityOverrides: { LEADER: { 'task.restore': false }, MEMBER: { 'task.restore': true } } }
    const t = await newTask()
    await cancelTaskFor(f.leader, t.id)

    await expect(restoreTaskFor(me, t.id)).rejects.toThrow('Sem permissão')

    expect((await statusOf(t.id)).status).toBe('cancelled')
  })
})

describe('restaurar tarefa de um board', () => {
  it('volta ao board quando ele segue ativo e vinculado à equipe', async () => {
    const board = await boardFor([f.team.id])
    const t = await taskOnBoard(board.id)
    await cancelTaskFor(f.leader, t.id)

    await restoreTaskFor(f.leader, t.id)

    expect(await statusOf(t.id)).toMatchObject({ status: 'pending', boardId: board.id })
  })

  it('recusa quando o board foi arquivado depois do cancelamento', async () => {
    const board = await boardFor([f.team.id])
    const t = await taskOnBoard(board.id)
    await cancelTaskFor(f.leader, t.id)
    await archiveBoardFor(admin, board.id)

    await expect(restoreTaskFor(f.leader, t.id)).rejects.toThrow('Board arquivado')

    expect((await statusOf(t.id)).status).toBe('cancelled')
  })

  it('recusa quando a equipe foi desvinculada do board depois do cancelamento', async () => {
    const board = await boardFor([f.team.id])
    const t = await taskOnBoard(board.id)
    await cancelTaskFor(f.leader, t.id)
    await unlinkTeamFromBoardFor(admin, board.id, f.team.id)

    await expect(restoreTaskFor(f.leader, t.id)).rejects.toThrow('não está vinculado')

    expect((await statusOf(t.id)).status).toBe('cancelled')
  })
})

describe('restaurar tentativa de desafio', () => {
  it('recusa com mensagem clara, mesmo com outra tentativa já aberta', async () => {
    const challenge = await addChallenge(f)
    const attempter = f.members[0]!
    const cancelled = await attemptChallengeFor(attempter, challenge.id)
    await cancelTaskFor(f.leader, cancelled.id)
    await attemptChallengeFor(attempter, challenge.id)

    await expect(restoreTaskFor(f.leader, cancelled.id)).rejects.toThrow('Tentativa de desafio')

    expect((await statusOf(cancelled.id)).status).toBe('cancelled')
  })
})

describe('restaurar tarefa cujo responsável já não é membro ativo', () => {
  const cancelledAssignedTo = async (assignee: AuthCtx) => {
    const t = await newTask({ assignedToId: assignee.userId })
    await cancelTaskFor(f.leader, t.id)
    return t
  }

  it('volta ao pool quando o responsável saiu da equipe', async () => {
    const leaver = await addUser(f, { role: 'MEMBER', team: f.team })
    const t = await cancelledAssignedTo(leaver)
    await db.transaction((tx) => removeMember(tx, admin, { teamId: f.team.id, userId: leaver.userId }))

    await restoreTaskFor(f.leader, t.id)

    expect(await statusOf(t.id)).toMatchObject({ status: 'pending', assignedToId: null })
  })

  it('volta ao pool quando o responsável foi desativado', async () => {
    const deactivated = await addUser(f, { role: 'MEMBER', team: f.team })
    const t = await cancelledAssignedTo(deactivated)
    await db.update(users).set({ banned: true }).where(eq(users.id, deactivated.userId))

    await restoreTaskFor(f.leader, t.id)

    expect(await statusOf(t.id)).toMatchObject({ status: 'pending', assignedToId: null })
  })

  it('audita a perda do responsável junto com o status', async () => {
    const leaver = await addUser(f, { role: 'MEMBER', team: f.team })
    const t = await cancelledAssignedTo(leaver)
    await db.transaction((tx) => removeMember(tx, admin, { teamId: f.team.id, userId: leaver.userId }))

    await restoreTaskFor(f.leader, t.id)

    const [e] = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, t.id), eq(auditEvents.action, 'task.restored')))
    expect(e!.changes).toMatchObject({ status: { from: 'cancelled', to: 'pending' }, assignedToId: { from: leaver.userId, to: null } })
  })

  it('restaurar enquanto o responsável sai espera a saída e devolve ao pool, sem deixá-lo com a tarefa', async () => {
    const leaver = await addUser(f, { role: 'MEMBER', team: f.team })
    const t = await cancelledAssignedTo(leaver)
    let restore: Promise<unknown> = Promise.resolve()

    await db.transaction(async (tx) => {
      await removeMember(tx, admin, { teamId: f.team.id, userId: leaver.userId })
      restore = restoreTaskFor(f.leader, t.id)
      await new Promise((resolve) => setTimeout(resolve, 200))
    })
    await restore

    expect(await statusOf(t.id)).toMatchObject({ status: 'pending', assignedToId: null })
  })
})

