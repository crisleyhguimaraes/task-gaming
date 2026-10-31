import { and, asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { auditEvents, users } from '#/db/schema'
import { auth } from '#/lib/auth'
import { addLoginUser, makeTenant } from './test-fixtures'

let f: Awaited<ReturnType<typeof makeTenant>>
const password = 'senha-forte-123'

const createUser = (role: 'MEMBER' | 'SUPER_ADMIN', label: string) => addLoginUser(f, { label, password, role })

const cookiePairs = (headers: Headers) => headers.getSetCookie().map((c) => c.split(';')[0]!)

function mergeCookies(...jars: Array<Array<string>>) {
  const byName = new Map<string, string>()
  for (const pair of jars.flat()) byName.set(pair.split('=')[0]!, pair)
  return new Headers({ cookie: [...byName.values()].join('; ') })
}

const authEvents = (entityId: string) =>
  db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.tenantId, f.tenant.id), eq(auditEvents.entityId, entityId)))
    .orderBy(asc(auditEvents.createdAt))

beforeAll(async () => {
  f = await makeTenant(0)
})
afterAll(async () => {
  await f.cleanup()
  await db.$client.end()
})

describe('eventos de autenticação', () => {
  it('login registra o usuário e o tenant', async () => {
    const u = await createUser('MEMBER', 'login')

    await auth.api.signInEmail({ body: { email: u.email, password } })

    const [e] = await authEvents(u.id)
    expect(e).toMatchObject({ action: 'auth.login', entityType: 'user', actorId: u.id, actorName: 'login', impersonatedBy: null })
  })

  it('senha errada de email existente registra falha; email inexistente não registra nada', async () => {
    const u = await createUser('MEMBER', 'falha')

    await expect(auth.api.signInEmail({ body: { email: u.email, password: 'errada-12345' } })).rejects.toThrow()
    await expect(auth.api.signInEmail({ body: { email: `ninguem-${f.tenant.slug}@test.local`, password: 'errada-12345' } })).rejects.toThrow()

    expect((await authEvents(u.id)).map((e) => e.action)).toEqual(['auth.login_failed'])
    const all = await db.select().from(auditEvents).where(eq(auditEvents.tenantId, f.tenant.id))
    expect(all.filter((e) => e.action === 'auth.login_failed')).toHaveLength(1)
  })

  it('impersonar e voltar registram quem entrou como quem', async () => {
    const admin = await createUser('SUPER_ADMIN', 'super')
    const target = await createUser('MEMBER', 'alvo')
    const { headers: adminHeaders } = await auth.api.signInEmail({ body: { email: admin.email, password }, returnHeaders: true })
    const adminJar = cookiePairs(adminHeaders)

    const { headers: impHeaders } = await auth.api.impersonateUser({ body: { userId: target.id }, headers: mergeCookies(adminJar), returnHeaders: true })
    await auth.api.stopImpersonating({ headers: mergeCookies(adminJar, cookiePairs(impHeaders)) })

    const events = await authEvents(target.id)
    expect(events.map((e) => e.action)).toEqual(['impersonation.started', 'impersonation.stopped'])
    expect(events[0]).toMatchObject({ actorId: admin.id, actorName: 'super', entityType: 'user', tenantId: f.tenant.id })
    expect(events[1]).toMatchObject({ actorId: admin.id })
    const [t] = await db.select().from(users).where(eq(users.id, target.id))
    expect(t!.tenantId).toBe(f.tenant.id)
  })
})
