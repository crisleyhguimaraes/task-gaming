import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { auditEvents } from '#/db/schema'
import { auditDenials } from './access.core'
import { fail, forbid, requireCan } from './roles'
import { makeTenant } from './test-fixtures'

let f: Awaited<ReturnType<typeof makeTenant>>

const deniedEvents = () =>
  db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.tenantId, f.tenant.id), eq(auditEvents.action, 'access.denied')))

beforeAll(async () => {
  f = await makeTenant(1)
})
afterAll(async () => {
  await f.cleanup()
  await db.$client.end()
})

describe('auditDenials', () => {
  it('negação de acesso é relançada e deixa rastro com usuário, tenant e função', async () => {
    const member = f.members[0]!

    await expect(auditDenials(member, { function: 'listAuditPage' }, async () => requireCan(member, 'audit.read'))).rejects.toThrow('Sem permissão')

    const [event] = await deniedEvents()
    expect(event).toMatchObject({ actorId: member.userId, actorName: member.name, entityType: 'user', entityId: member.userId, meta: { function: 'listAuditPage' } })
  })

  it('erro comum passa intacto e não vira negação de acesso', async () => {
    const before = (await deniedEvents()).length

    await expect(auditDenials(f.leader, { function: 'x' }, async () => fail('Tarefa não encontrada'))).rejects.toThrow('Tarefa não encontrada')

    expect(await deniedEvents()).toHaveLength(before)
  })

  it('sucesso devolve o resultado sem registrar nada', async () => {
    const before = (await deniedEvents()).length

    await expect(auditDenials(f.leader, { function: 'x' }, async () => 42)).resolves.toBe(42)

    expect(await deniedEvents()).toHaveLength(before)
  })

  it('durante impersonação o evento guarda quem estava impersonando', async () => {
    const impersonated = { ...f.members[0]!, impersonatedBy: 'super-1' }

    await expect(auditDenials(impersonated, { function: 'y' }, async () => forbid())).rejects.toThrow('Sem permissão')

    const events = await deniedEvents()
    expect(events.find((e) => e.meta?.function === 'y')).toMatchObject({ impersonatedBy: 'super-1' })
  })
})
