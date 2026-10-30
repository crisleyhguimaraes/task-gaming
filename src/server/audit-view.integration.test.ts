import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { auditEvents, users } from '#/db/schema'
import { auditActorsFor, listAuditPageFor } from './audit-view.core'
import type { AuthCtx } from './roles'
import { addAdmin, makeTenant } from './test-fixtures'

let f: Awaited<ReturnType<typeof makeTenant>>
let other: Awaited<ReturnType<typeof makeTenant>>
let admin: AuthCtx
let superAdminId: string

beforeAll(async () => {
  f = await makeTenant(1)
  other = await makeTenant(1)
  admin = await addAdmin(f)
  superAdminId = `sa-${f.tenant.slug}`
  await db.insert(users).values({ id: superAdminId, name: 'Super Fulano', email: `${superAdminId}@test.local`, role: 'SUPER_ADMIN', tenantId: f.tenant.id })
  await db.insert(auditEvents).values([
    { tenantId: f.tenant.id, actorId: admin.userId, actorName: admin.name, action: 'task.updated', entityType: 'task', entityId: 'direto' },
    { tenantId: f.tenant.id, actorId: admin.userId, actorName: admin.name, impersonatedBy: superAdminId, action: 'task.updated', entityType: 'task', entityId: 'via-super' },
    { tenantId: f.tenant.id, actorId: admin.userId, actorName: admin.name, impersonatedBy: 'apagado', action: 'task.updated', entityType: 'task', entityId: 'via-apagado' },
  ])
})
afterAll(async () => {
  await f.cleanup()
  await other.cleanup()
  await db.$client.end()
})

describe('página de auditoria', () => {
  it('resolve o nome de quem impersonou; sem impersonação ou com usuário removido fica nulo', async () => {
    const { events } = await listAuditPageFor(admin, { entityType: 'task' })

    const nameByEntity = Object.fromEntries(events.map((e) => [e.entityId, e.impersonatorName]))
    expect(nameByEntity).toEqual({ direto: null, 'via-super': 'Super Fulano', 'via-apagado': null })
  })

  it('mantém a paginação por cursor', async () => {
    const first = await listAuditPageFor(admin, { entityType: 'task', limit: 2 })
    const second = await listAuditPageFor(admin, { entityType: 'task', limit: 2, cursor: first.nextCursor! })

    expect(first.events).toHaveLength(2)
    expect(second.events).toHaveLength(1)
    expect(second.nextCursor).toBeNull()
  })

  it('exige audit.read', async () => {
    await expect(listAuditPageFor(f.leader, {})).rejects.toThrow('Sem permissão')
  })

  it('lista como opções de filtro só as pessoas do tenant', async () => {
    const actors = await auditActorsFor(admin)

    expect(actors.map((a) => a.id)).toContain(f.leader.userId)
    expect(actors.map((a) => a.id)).not.toContain(other.leader.userId)
    await expect(auditActorsFor(f.members[0]!)).rejects.toThrow('Sem permissão')
  })
})
