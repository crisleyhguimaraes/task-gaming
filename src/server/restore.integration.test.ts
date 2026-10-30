import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { auditEvents, tasks } from '#/db/schema'
import type { AuthCtx } from './roles'
import { cancelTaskFor, restoreTaskFor } from './tasks.core'
import { makeTenant } from './test-fixtures'

let f: Awaited<ReturnType<typeof makeTenant>>
let other: Awaited<ReturnType<typeof makeTenant>>
let outsider: AuthCtx

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
