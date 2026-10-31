import { and, asc, eq, inArray } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { auditEvents, boardTeams, boards, tasks } from '#/db/schema'
import { archiveBoardFor, createBoardFor, unlinkTeamFromBoardFor } from './boards.core'
import { exportTasksCsvFor } from './exports.core'
import type { AuthCtx } from './roles'
import type { NewTask } from './tasks.core'
import { createTaskFor, taskListWhere, updateTaskFor } from './tasks.core'
import { addAdmin, addTeam, addUser, makeTenant } from './test-fixtures'

type Fixture = Awaited<ReturnType<typeof makeTenant>>

let f: Fixture
let other: Fixture
let admin: AuthCtx
let otherAdmin: AuthCtx
let teamB: { id: string }

let sequence = 0
const uniqueName = (label: string) => `${label} ${++sequence}`

const boardFor = (teamIds: Array<string>, label = 'Quadro') => createBoardFor(admin, { name: uniqueName(label), teamIds })

const input = (overrides: Partial<NewTask> = {}): NewTask => ({ title: uniqueName('Tarefa'), basePoints: 10, estimatedMinutes: 10, teamId: f.team.id, assignedToId: null, ...overrides })

type TaskRow = typeof tasks.$inferSelect

const edit = (task: TaskRow, overrides: Partial<Parameters<typeof updateTaskFor>[1]> = {}) => ({
  taskId: task.id,
  title: task.title,
  basePoints: task.basePoints,
  estimatedMinutes: task.estimatedSeconds / 60,
  priority: task.priority,
  dueDate: task.dueDate,
  scheduledStart: task.scheduledStart,
  scheduledEnd: task.scheduledEnd,
  assignedToId: task.assignedToId,
  ...overrides,
})

const reload = async (id: string) => (await db.select().from(tasks).where(eq(tasks.id, id)))[0]!

const auditFor = (entityId: string) =>
  db.select().from(auditEvents).where(and(eq(auditEvents.tenantId, f.tenant.id), eq(auditEvents.entityId, entityId))).orderBy(asc(auditEvents.createdAt), asc(auditEvents.id))

const titlesListed = async (me: AuthCtx, filters: Parameters<typeof taskListWhere>[1]) =>
  (await db.select({ title: tasks.title }).from(tasks).where(taskListWhere(me, filters))).map((r) => r.title)

beforeAll(async () => {
  f = await makeTenant(2)
  other = await makeTenant(0)
  admin = await addAdmin(f)
  otherAdmin = await addAdmin(other)
  teamB = await addTeam(f, 'Equipe B')
})
afterAll(async () => {
  await f.cleanup()
  await other.cleanup()
  await db.$client.end()
})

describe('createTaskFor com board', () => {
  it('grava o board quando a equipe da tarefa está vinculada a ele, e audita', async () => {
    const board = await boardFor([f.team.id])

    const task = await createTaskFor(f.leader, input({ boardId: board.id }))

    expect(task.boardId).toBe(board.id)
    expect((await auditFor(task.id))[0]).toMatchObject({ action: 'task.created', meta: { boardId: board.id } })
  })

  it('sem board (omitido ou nulo) é sempre válido, mesmo existindo boards', async () => {
    await boardFor([f.team.id])

    const omitted = await createTaskFor(f.leader, input())
    const explicit = await createTaskFor(f.leader, input({ boardId: null }))

    expect(omitted.boardId).toBeNull()
    expect(explicit.boardId).toBeNull()
  })

  it('recusa board que não está vinculado à equipe da tarefa', async () => {
    const board = await boardFor([teamB.id])
    const unlinked = await boardFor([])

    await expect(createTaskFor(f.leader, input({ boardId: board.id }))).rejects.toThrow('não está vinculado')
    await expect(createTaskFor(f.leader, input({ boardId: unlinked.id }))).rejects.toThrow('não está vinculado')
  })

  it('recusa board arquivado', async () => {
    const board = await boardFor([f.team.id])
    await archiveBoardFor(admin, board.id)

    await expect(createTaskFor(f.leader, input({ boardId: board.id }))).rejects.toThrow('Board arquivado')
  })

  it('board de outro tenant ou inexistente é "não encontrado"', async () => {
    const theirs = await createBoardFor(otherAdmin, { name: uniqueName('Deles'), teamIds: [other.team.id] })

    await expect(createTaskFor(f.leader, input({ boardId: theirs.id }))).rejects.toThrow('Board não encontrado')
    await expect(createTaskFor(f.leader, input({ boardId: randomUUID() }))).rejects.toThrow('Board não encontrado')
  })
})

describe('updateTaskFor com board', () => {
  it('mudar, trocar e tirar o board entram no diff de task.updated', async () => {
    const [first, second] = [await boardFor([f.team.id]), await boardFor([f.team.id])]
    const task = await createTaskFor(f.leader, input())

    await updateTaskFor(f.leader, edit(task, { boardId: first.id }))
    await updateTaskFor(f.leader, edit(await reload(task.id), { boardId: second.id }))
    await updateTaskFor(f.leader, edit(await reload(task.id), { boardId: null }))

    const changes = (await auditFor(task.id)).filter((e) => e.action === 'task.updated').map((e) => e.changes)
    expect(changes).toEqual([
      { boardId: { from: null, to: first.id } },
      { boardId: { from: first.id, to: second.id } },
      { boardId: { from: second.id, to: null } },
    ])
    expect((await reload(task.id)).boardId).toBeNull()
  })

  it('board omitido mantém o atual', async () => {
    const board = await boardFor([f.team.id])
    const task = await createTaskFor(f.leader, input({ boardId: board.id }))

    await updateTaskFor(f.leader, edit(task, { title: 'Novo título' }))

    expect(await reload(task.id)).toMatchObject({ title: 'Novo título', boardId: board.id })
  })

  it('tarefa cujo board perdeu o vínculo ou foi arquivado continua editável se o board não muda', async () => {
    const board = await boardFor([f.team.id])
    const task = await createTaskFor(f.leader, input({ boardId: board.id }))
    await db.update(tasks).set({ status: 'finished' }).where(eq(tasks.id, task.id))
    const live = await createTaskFor(f.leader, input({ boardId: board.id }))
    await db.delete(boardTeams).where(eq(boardTeams.boardId, board.id))

    await updateTaskFor(f.leader, edit(live, { title: 'Editada sem vínculo', boardId: board.id }))

    expect(await reload(live.id)).toMatchObject({ title: 'Editada sem vínculo', boardId: board.id })
  })

  it('recusa mudar para board desvinculado, arquivado ou de outro tenant', async () => {
    const task = await createTaskFor(f.leader, input())
    const notMine = await boardFor([teamB.id])
    const archived = await boardFor([f.team.id])
    await archiveBoardFor(admin, archived.id)
    const theirs = await createBoardFor(otherAdmin, { name: uniqueName('Deles'), teamIds: [other.team.id] })

    await expect(updateTaskFor(f.leader, edit(task, { boardId: notMine.id }))).rejects.toThrow('não está vinculado')
    await expect(updateTaskFor(f.leader, edit(task, { boardId: archived.id }))).rejects.toThrow('Board arquivado')
    await expect(updateTaskFor(f.leader, edit(task, { boardId: theirs.id }))).rejects.toThrow('Board não encontrado')
    expect((await reload(task.id)).boardId).toBeNull()
  })
})

describe('taskListWhere com board', () => {
  it('filtra por board e por "none" (sem board)', async () => {
    const board = await boardFor([f.team.id])
    const inBoard = await createTaskFor(admin, input({ boardId: board.id }))
    const loose = await createTaskFor(admin, input())

    const onBoard = await titlesListed(admin, { boardId: board.id })
    const withoutBoard = await titlesListed(admin, { boardId: 'none' })
    const everything = await titlesListed(admin, {})

    expect(onBoard).toEqual([inBoard.title])
    expect(withoutBoard).toContain(loose.title)
    expect(withoutBoard).not.toContain(inBoard.title)
    expect(everything).toEqual(expect.arrayContaining([inBoard.title, loose.title]))
  })

  it('board compartilhado não mostra a tarefa de equipe alheia', async () => {
    const shared = await boardFor([f.team.id, teamB.id])
    const mine = await createTaskFor(admin, input({ boardId: shared.id, teamId: f.team.id }))
    const theirs = await createTaskFor(admin, input({ boardId: shared.id, teamId: teamB.id }))
    const memberOfB = await addUser(f, { role: 'MEMBER', team: teamB })

    expect(await titlesListed(f.members[0]!, { boardId: shared.id })).toEqual([mine.title])
    expect(await titlesListed(memberOfB, { boardId: shared.id })).toEqual([theirs.title])
    expect((await titlesListed(admin, { boardId: shared.id })).sort()).toEqual([mine.title, theirs.title].sort())
  })

  it('a exportação CSV herda o filtro de board', async () => {
    const board = await boardFor([f.team.id])
    const inBoard = await createTaskFor(admin, input({ boardId: board.id }))
    const loose = await createTaskFor(admin, input())

    const { content } = await exportTasksCsvFor(admin, { boardId: board.id })

    expect(content).toContain(inBoard.title)
    expect(content).not.toContain(loose.title)
  })
})

describe('concorrência', () => {
  const rounds = 6

  const liveOn = (boardId: string) => db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.boardId, boardId), inArray(tasks.status, ['pending', 'in_progress', 'paused'])))
  const archivedOf = async (boardId: string) => (await db.select({ archivedAt: boards.archivedAt }).from(boards).where(eq(boards.id, boardId)))[0]!.archivedAt !== null

  it('arquivar × criar tarefa no board: nunca sobra tarefa viva em board arquivado', async () => {
    for (let round = 0; round < rounds; round++) {
      const board = await boardFor([f.team.id], 'Corrida de arquivo')

      const results = await Promise.allSettled([archiveBoardFor(admin, board.id), createTaskFor(f.leader, input({ boardId: board.id }))])

      expect((await archivedOf(board.id)) && (await liveOn(board.id)).length > 0).toBe(false)
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    }
  })

  it('desvincular × criar tarefa: nunca sobra tarefa viva da equipe num board desvinculado', async () => {
    for (let round = 0; round < rounds; round++) {
      const board = await boardFor([f.team.id], 'Corrida de vínculo')

      const results = await Promise.allSettled([unlinkTeamFromBoardFor(admin, board.id, f.team.id), createTaskFor(f.leader, input({ boardId: board.id }))])

      const stillLinked = (await db.select().from(boardTeams).where(eq(boardTeams.boardId, board.id))).length > 0
      expect(!stillLinked && (await liveOn(board.id)).length > 0).toBe(false)
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    }
  })
})
