import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { notifications, tasks } from '#/db/schema'
import { addNoteFor } from './notes.core'
import { countUnreadFor, listMyNotificationsFor, markAllReadFor, markReadFor, notify } from './notifications.core'
import type { AuthCtx } from './roles'
import { createTaskFor, updateTaskFor, validatePointsFor } from './tasks.core'
import type { TaskEdit } from './tasks.core'
import { makeTenant } from './test-fixtures'

let f: Awaited<ReturnType<typeof makeTenant>>
let other: Awaited<ReturnType<typeof makeTenant>>
let ana: AuthCtx
let bia: AuthCtx
let cara: AuthCtx
let dan: AuthCtx

const send = (author: AuthCtx, userIds: Array<string | null>) =>
  db.transaction((tx) => notify(tx, author, { userIds, type: 'task.assigned', entityType: 'task', entityId: 'e1', payload: { taskTitle: 'T' } }))

const newTask = async (patch: Partial<typeof tasks.$inferInsert> = {}) => {
  const [t] = await db
    .insert(tasks)
    .values({ tenantId: f.tenant.id, teamId: f.team.id, createdById: f.leader.userId, title: 'Tarefa X', basePoints: 100, estimatedSeconds: 600, ...patch })
    .returning()
  return t!
}

const editOf = (t: typeof tasks.$inferSelect, patch: Partial<TaskEdit>): TaskEdit => ({
  taskId: t.id,
  title: t.title,
  basePoints: t.basePoints,
  estimatedMinutes: t.estimatedSeconds / 60,
  assignedToId: t.assignedToId,
  priority: t.priority,
  dueDate: null,
  scheduledStart: null,
  scheduledEnd: null,
  ...patch,
})

const inboxOf = (me: AuthCtx) => listMyNotificationsFor(me)

beforeAll(async () => {
  f = await makeTenant(4)
  other = await makeTenant(1)
  ;[ana, bia, cara, dan] = f.members as [AuthCtx, AuthCtx, AuthCtx, AuthCtx]
})
afterAll(async () => {
  await f.cleanup()
  await other.cleanup()
  await db.$client.end()
})

describe('notify', () => {
  it('cria uma notificação por destinatário e ignora o próprio autor, nulos e repetidos', async () => {
    await send(ana, [ana.userId, bia.userId, bia.userId, null])

    expect(await inboxOf(ana)).toHaveLength(0)
    expect(await inboxOf(bia)).toHaveLength(1)
  })

  it('guarda tipo, entidade e conteúdo', async () => {
    await send(f.leader, [bia.userId])

    const [n] = await inboxOf(bia)
    expect(n).toMatchObject({ type: 'task.assigned', entityType: 'task', entityId: 'e1', payload: { taskTitle: 'T' }, readAt: null })
  })
})

describe('caixa de entrada', () => {
  it('lista só as minhas, da mais nova para a mais antiga, e conta as não lidas', async () => {
    const owner = cara
    const peer = dan
    await db.insert(notifications).values([
      { tenantId: f.tenant.id, userId: owner.userId, type: 'note.created', entityType: 'task', entityId: 'velha', createdAt: new Date('2026-01-01') },
      { tenantId: f.tenant.id, userId: owner.userId, type: 'note.created', entityType: 'task', entityId: 'nova', createdAt: new Date('2026-02-01') },
      { tenantId: f.tenant.id, userId: peer.userId, type: 'note.created', entityType: 'task', entityId: 'alheia' },
    ])

    const mine = await inboxOf(owner)

    expect(mine.map((n) => n.entityId)).toEqual(['nova', 'velha'])
    expect(await countUnreadFor(owner)).toBe(2)
  })

  it('marcar como lida reduz a contagem e só vale para o dono', async () => {
    const owner = dan
    const stranger = other.members[0]!
    await send(f.leader, [owner.userId])
    const [n] = await inboxOf(owner)
    const before = await countUnreadFor(owner)

    await markReadFor(stranger, n!.id)
    expect(await countUnreadFor(owner)).toBe(before)

    await markReadFor(owner, n!.id)
    expect(await countUnreadFor(owner)).toBe(before - 1)
  })

  it('marcar todas como lidas não toca nas dos outros', async () => {
    const owner = cara
    const peer = dan
    await send(ana, [owner.userId, peer.userId])
    const peerUnread = await countUnreadFor(peer)

    await markAllReadFor(owner)

    expect(await countUnreadFor(owner)).toBe(0)
    expect(await countUnreadFor(peer)).toBe(peerUnread)
  })

  it('usuário de outro tenant não vê nada, mesmo com o mesmo userId', async () => {
    await send(f.leader, [ana.userId])
    const impostor: AuthCtx = { ...ana, tenantId: other.tenant.id }

    expect(await inboxOf(impostor)).toHaveLength(0)
    expect(await countUnreadFor(impostor)).toBe(0)
  })
})

describe('gatilhos', () => {
  it('criar tarefa para outra pessoa avisa o responsável', async () => {
    const task = await createTaskFor(f.leader, { title: 'Nova', basePoints: 10, estimatedMinutes: 5, teamId: f.team.id, assignedToId: ana.userId })

    const sent = (await inboxOf(ana)).find((n) => n.entityId === task.id)
    expect(sent).toMatchObject({ type: 'task.assigned', entityType: 'task', payload: { taskTitle: 'Nova', by: f.leader.name } })
  })

  it('criar tarefa para si mesmo ou para o pool não avisa ninguém', async () => {
    const mine = await createTaskFor(f.leader, { title: 'Minha', basePoints: 10, estimatedMinutes: 5, teamId: f.team.id, assignedToId: f.leader.userId })
    const pool = await createTaskFor(f.leader, { title: 'Pool', basePoints: 10, estimatedMinutes: 5, teamId: f.team.id, assignedToId: null })

    const sent = await db.select().from(notifications).where(eq(notifications.tenantId, f.tenant.id))
    expect(sent.filter((n) => n.entityId === mine.id || n.entityId === pool.id)).toHaveLength(0)
  })

  it('reatribuir avisa o novo responsável; editar sem trocar o responsável não avisa', async () => {
    const task = await newTask({ assignedToId: ana.userId })

    await updateTaskFor(f.leader, editOf(task, { title: 'Só o título' }))
    expect((await inboxOf(ana)).some((n) => n.entityId === task.id)).toBe(false)

    await updateTaskFor(f.leader, editOf(task, { assignedToId: bia.userId }))
    expect((await inboxOf(bia)).some((n) => n.entityId === task.id && n.type === 'task.assigned')).toBe(true)
  })

  it('atribuir a tarefa do pool a alguém avisa essa pessoa', async () => {
    const task = await newTask({ assignedToId: null })

    await updateTaskFor(f.leader, editOf(task, { assignedToId: ana.userId }))

    expect((await inboxOf(ana)).some((n) => n.entityId === task.id)).toBe(true)
  })

  it.each([
    [true, 'points.approved'],
    [false, 'points.rejected'],
  ])('validar pontos (aprovar=%s) avisa o responsável com %s', async (approve, type) => {
    const task = await newTask({ assignedToId: ana.userId, status: 'finished', needsValidation: true, awardedPoints: 50 })

    await validatePointsFor(f.leader, task.id, approve, 'motivo')

    const sent = (await inboxOf(ana)).find((n) => n.entityId === task.id)
    expect(sent).toMatchObject({ type, payload: { taskTitle: 'Tarefa X' } })
  })

  it('nota em tarefa avisa responsável e criador, menos o autor', async () => {
    const task = await newTask({ assignedToId: ana.userId, createdById: f.leader.userId })

    await addNoteFor(ana, { type: 'task', id: task.id }, 'oi')

    const forLeader = (await inboxOf(f.leader)).find((n) => n.entityId === task.id)
    expect(forLeader).toMatchObject({ type: 'note.created', payload: { taskTitle: 'Tarefa X', by: ana.name } })
    expect((await inboxOf(ana)).some((n) => n.entityId === task.id)).toBe(false)
  })

  it('nota de um terceiro avisa os dois, e tarefa sem responsável avisa só o criador', async () => {
    const assigned = await newTask({ assignedToId: ana.userId })
    const pooled = await newTask({ assignedToId: null })

    await addNoteFor(bia, { type: 'task', id: assigned.id }, 'oi')
    await addNoteFor(bia, { type: 'task', id: pooled.id }, 'oi')

    const all = await db.select().from(notifications).where(eq(notifications.tenantId, f.tenant.id))
    const recipients = (taskId: string) => all.filter((n) => n.entityId === taskId && n.type === 'note.created').map((n) => n.userId).sort()
    expect(recipients(assigned.id)).toEqual([ana.userId, f.leader.userId].sort())
    expect(recipients(pooled.id)).toEqual([f.leader.userId])
  })
})
