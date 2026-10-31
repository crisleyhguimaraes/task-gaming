import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { tasks, teamMembers } from '#/db/schema'
import type { AuthCtx } from './roles'
import { createTaskFor, releaseOpenWork, startTaskFor, updateTaskFor } from './tasks.core'
import type { TaskEdit } from './tasks.core'
import { removeMember } from './team-members.core'
import { addUser, makeTenant } from './test-fixtures'

let f: Awaited<ReturnType<typeof makeTenant>>

const LOCK_PROBE_MS = 200
const ROUNDS = 8
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const taskRow = async (id: string) => (await db.select().from(tasks).where(eq(tasks.id, id)))[0]!

async function newTask(assignedToId: string | null = null) {
  const [t] = await db
    .insert(tasks)
    .values({ tenantId: f.tenant.id, teamId: f.team.id, assignedToId, createdById: f.leader.userId, title: 'T', basePoints: 100, estimatedSeconds: 600 })
    .returning()
  return t!
}

const editTo = (task: typeof tasks.$inferSelect, assignedToId: string | null): TaskEdit => ({
  taskId: task.id,
  title: task.title,
  basePoints: task.basePoints,
  estimatedMinutes: task.estimatedSeconds / 60,
  priority: task.priority,
  dueDate: task.dueDate,
  scheduledStart: task.scheduledStart,
  scheduledEnd: task.scheduledEnd,
  assignedToId,
})

const assignTo = (userId: string) => createTaskFor(f.leader, { title: 'Atribuída', basePoints: 10, estimatedMinutes: 10, teamId: f.team.id, assignedToId: userId })

const leave = async (userId: string) => {
  const admin = await addUser(f, { role: 'TENANT_ADMIN', team: null })
  await db.transaction((tx) => removeMember(tx, admin, { teamId: f.team.id, userId }))
}

const assignedTo = (userId: string) => db.select().from(tasks).where(eq(tasks.assignedToId, userId))

beforeAll(async () => {
  f = await makeTenant(2)
})
afterAll(async () => {
  await f.cleanup()
  await db.$client.end()
})

describe('editar × iniciar a tarefa', () => {
  it('a edição que reatribui espera o início em curso e então o recusa, sem trocar o executor', async () => {
    const [runner, other] = f.members as [AuthCtx, AuthCtx]
    const task = await newTask()
    let reassign: Promise<unknown> = Promise.resolve()

    await db.transaction(async (tx) => {
      await tx.update(tasks).set({ status: 'in_progress', assignedToId: runner.userId }).where(eq(tasks.id, task.id))
      reassign = updateTaskFor(f.leader, editTo(task, other.userId)).catch((e: Error) => e.message)
      await wait(LOCK_PROBE_MS)
    })

    expect(await reassign).toBe('Só tarefas pendentes podem ser reatribuídas')
    expect(await taskRow(task.id)).toMatchObject({ status: 'in_progress', assignedToId: runner.userId })
  })

  it('iniciar e reatribuir ao mesmo tempo nunca deixa tarefa em andamento com outro responsável', async () => {
    const [runner, other] = f.members as [AuthCtx, AuthCtx]
    for (let round = 0; round < ROUNDS; round++) {
      const task = await newTask()

      await Promise.allSettled([startTaskFor(runner, task.id), updateTaskFor(f.leader, editTo(task, other.userId))])

      const row = await taskRow(task.id)
      if (row.status === 'in_progress') expect(row.assignedToId).toBe(runner.userId)
    }
  })

  it('editar a tarefa de quem está saindo da equipe, sem trocar o responsável, não trava o vínculo e não dá impasse', async () => {
    const leaving = await addUser(f, { role: 'MEMBER', team: f.team })
    const task = await newTask(leaving.userId)
    let edit: Promise<string> = Promise.resolve('')

    await db.transaction(async (tx) => {
      await tx.delete(teamMembers).where(and(eq(teamMembers.teamId, f.team.id), eq(teamMembers.userId, leaving.userId)))
      edit = updateTaskFor(f.leader, editTo(task, leaving.userId)).then(() => 'ok', (e: Error) => e.message)
      await wait(LOCK_PROBE_MS)
      await releaseOpenWork(tx, leaving.userId, f.team.id)
    })

    expect(await edit).toBe('ok')
    expect(await taskRow(task.id)).toMatchObject({ assignedToId: null, status: 'pending' })
  })

  it('editar a tarefa de quem está saindo da equipe, em corrida com a saída, termina sem impasse', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const leaving = await addUser(f, { role: 'MEMBER', team: f.team })
      const task = await newTask(leaving.userId)

      const [edited, left] = await Promise.allSettled([updateTaskFor(f.leader, editTo(task, leaving.userId)), leave(leaving.userId)])

      expect(left.status).toBe('fulfilled')
      if (edited.status === 'rejected') expect(edited.reason.message).toBe('Responsável não pertence à equipe')
      expect(await taskRow(task.id)).toMatchObject({ assignedToId: null, status: 'pending' })
    }
  })
})

describe('atribuir × sair da equipe', () => {
  it('atribuir a quem está saindo espera a saída e então recusa', async () => {
    const leaving = await addUser(f, { role: 'MEMBER', team: f.team })
    const admin = await addUser(f, { role: 'TENANT_ADMIN', team: null })
    let assign: Promise<unknown> = Promise.resolve()

    await db.transaction(async (tx) => {
      await removeMember(tx, admin, { teamId: f.team.id, userId: leaving.userId })
      assign = assignTo(leaving.userId).catch((e: Error) => e.message)
      await wait(LOCK_PROBE_MS)
    })

    expect(await assign).toBe('Responsável não pertence à equipe')
    expect(await assignedTo(leaving.userId)).toEqual([])
  })

  it('criar com responsável e ele sair ao mesmo tempo nunca deixa tarefa com quem já não é membro', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const leaving = await addUser(f, { role: 'MEMBER', team: f.team })

      await Promise.allSettled([assignTo(leaving.userId), leave(leaving.userId)])

      expect(await assignedTo(leaving.userId)).toEqual([])
    }
  })
})
