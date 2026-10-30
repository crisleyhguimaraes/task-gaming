import { and, asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { auditEvents, tasks } from '#/db/schema'
import { listAuditEventsFor, recordAudit, taskHistoryFor } from './audit.core'
import { cancelTaskFor, createTaskFor, finishTaskManuallyFor, returnToPoolFor, updateTaskFor, validatePointsFor } from './tasks.core'
import { addAdmin, makeTenant } from './test-fixtures'
import type { AuthCtx } from './roles'

let f: Awaited<ReturnType<typeof makeTenant>>
let other: Awaited<ReturnType<typeof makeTenant>>
let admin: AuthCtx

const newTask = async (patch: Partial<typeof tasks.$inferInsert> = {}) => {
  const [t] = await db
    .insert(tasks)
    .values({ tenantId: f.tenant.id, teamId: f.team.id, createdById: f.leader.userId, title: 'T', basePoints: 100, estimatedSeconds: 600, ...patch })
    .returning()
  return t!
}

const eventsOf = (entityId: string) =>
  db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.tenantId, f.tenant.id), eq(auditEvents.entityId, entityId)))
    .orderBy(asc(auditEvents.createdAt))

beforeAll(async () => {
  f = await makeTenant(2)
  other = await makeTenant(0)
  admin = await addAdmin(f)
})
afterAll(async () => {
  await f.cleanup()
  await other.cleanup()
  await db.$client.end()
})

describe('eventos de tarefa', () => {
  it('cancelar registra quem cancelou', async () => {
    const t = await newTask()

    await cancelTaskFor(f.leader, t.id)

    const [e] = await eventsOf(t.id)
    expect(e).toMatchObject({ action: 'task.cancelled', entityType: 'task', actorId: f.leader.userId, actorName: f.leader.name, impersonatedBy: null })
  })

  it('rejeitar pontos guarda o valor anterior, o novo e o motivo', async () => {
    const t = await newTask({ status: 'finished', needsValidation: true, awardedPoints: 80 })

    await validatePointsFor(f.leader, t.id, false, 'tempo impossível')

    const [e] = await eventsOf(t.id)
    expect(e).toMatchObject({ action: 'task.points_rejected', changes: { awardedPoints: { from: 80, to: 0 } }, meta: { reason: 'tempo impossível' } })
  })

  it('aprovar pontos mantém o valor e registra a aprovação', async () => {
    const t = await newTask({ status: 'finished', needsValidation: true, awardedPoints: 80 })

    await validatePointsFor(f.leader, t.id, true)

    const [e] = await eventsOf(t.id)
    expect(e).toMatchObject({ action: 'task.points_validated', changes: { needsValidation: { from: true, to: false } } })
  })

  it('devolver ao pool registra o responsável anterior', async () => {
    const t = await newTask({ assignedToId: f.members[0]!.userId })

    await returnToPoolFor(f.leader, t.id)

    const [e] = await eventsOf(t.id)
    expect(e).toMatchObject({ action: 'task.returned_to_pool', changes: { assignedToId: { from: f.members[0]!.userId, to: null } } })
  })

  it('durante impersonação, o ator é o usuário efetivo e o impersonador fica registrado', async () => {
    const t = await newTask()

    await cancelTaskFor({ ...f.leader, impersonatedBy: 'super-admin-1' }, t.id)

    const [e] = await eventsOf(t.id)
    expect(e).toMatchObject({ actorId: f.leader.userId, impersonatedBy: 'super-admin-1' })
  })
})

describe('criar, editar e concluir manualmente', () => {
  const base = { title: 'Nova', basePoints: 50, estimatedMinutes: 10, teamId: '', assignedToId: null }
  const edit = { description: '', priority: 'medium' as const, dueDate: null, scheduledStart: null, scheduledEnd: null }

  it('criar registra o evento com o responsável inicial', async () => {
    const t = await createTaskFor(f.leader, { ...base, teamId: f.team.id, assignedToId: f.members[0]!.userId })

    const [e] = await eventsOf(t.id)
    expect(e).toMatchObject({ action: 'task.created', actorId: f.leader.userId, meta: { title: 'Nova', assignedToId: f.members[0]!.userId } })
  })

  it('editar registra só os campos que mudaram', async () => {
    const t = await createTaskFor(f.leader, { ...base, teamId: f.team.id })

    await updateTaskFor(f.leader, { ...base, ...edit, taskId: t.id, basePoints: 80 })

    const [, e] = await eventsOf(t.id)
    expect(e).toMatchObject({ action: 'task.updated', changes: { basePoints: { from: 50, to: 80 } } })
    expect(Object.keys(e!.changes!)).toEqual(['basePoints'])
  })

  it('editar sem alterar nada não grava evento', async () => {
    const t = await createTaskFor(f.leader, { ...base, teamId: f.team.id })

    await updateTaskFor(f.leader, { ...base, ...edit, taskId: t.id })

    expect(await eventsOf(t.id)).toHaveLength(1)
  })

  it('conclusão manual registra pontos concedidos', async () => {
    const t = await newTask({ assignedToId: f.members[0]!.userId })

    await finishTaskManuallyFor(f.leader, t.id)

    const [e] = await eventsOf(t.id)
    expect(e).toMatchObject({ action: 'task.finished_manually', changes: { status: { from: 'pending', to: 'finished' }, awardedPoints: { from: null, to: 100 } } })
  })
})

describe('listAuditEventsFor', () => {
  it('lista só eventos do tenant do solicitante', async () => {
    await recordAudit(db, other.leader, { action: 'task.cancelled', entityType: 'task', entityId: 'alheia' })

    const { events } = await listAuditEventsFor(admin, {})

    expect(events.every((e) => e.tenantId === f.tenant.id)).toBe(true)
    expect(events.some((e) => e.entityId === 'alheia')).toBe(false)
  })

  it('filtra por ação e por entidade', async () => {
    const t = await newTask()
    await cancelTaskFor(f.leader, t.id)

    const byAction = await listAuditEventsFor(admin, { action: 'task.cancelled' })
    const byEntity = await listAuditEventsFor(admin, { entityType: 'task', entityId: t.id })

    expect(byAction.events.every((e) => e.action === 'task.cancelled')).toBe(true)
    expect(byEntity.events).toHaveLength(1)
  })

  it('pagina por cursor sem repetir nem pular eventos', async () => {
    const all = await listAuditEventsFor(admin, { limit: 200 })
    expect(all.events.length).toBeGreaterThan(2)

    const seen: Array<string> = []
    let cursor: string | undefined
    do {
      const page = await listAuditEventsFor(admin, { limit: 2, cursor })
      seen.push(...page.events.map((e) => e.id))
      cursor = page.nextCursor ?? undefined
    } while (cursor)

    expect(seen).toEqual(all.events.map((e) => e.id))
  })
})

describe('taskHistoryFor', () => {
  it('gestor vê o histórico da tarefa em ordem cronológica', async () => {
    const t = await createTaskFor(f.leader, { title: 'Histórica', basePoints: 10, estimatedMinutes: 5, teamId: f.team.id, assignedToId: null })
    await cancelTaskFor(f.leader, t.id)

    const history = await taskHistoryFor(f.leader, t.id)

    expect(history.map((e) => e.action)).toEqual(['task.created', 'task.cancelled'])
  })

  it('membro comum não vê o histórico', async () => {
    const t = await newTask({ assignedToId: f.members[0]!.userId })

    await expect(taskHistoryFor(f.members[0]!, t.id)).rejects.toThrow('Sem permissão')
  })

  it('tarefa de outro tenant não existe para o solicitante', async () => {
    const [foreign] = await db
      .insert(tasks)
      .values({ tenantId: other.tenant.id, teamId: other.team.id, createdById: other.leader.userId, title: 'Alheia', basePoints: 1, estimatedSeconds: 60 })
      .returning()

    await expect(taskHistoryFor(f.leader, foreign!.id)).rejects.toThrow('Tarefa não encontrada')
  })
})
