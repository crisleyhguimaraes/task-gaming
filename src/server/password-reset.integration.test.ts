import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '#/db'
import { auditEvents, sessions, users } from '#/db/schema'
import { auth } from '#/lib/auth'
import { sendMail } from './mail'
import { addLoginUser, makeTenant } from './test-fixtures'

vi.mock('./mail', () => ({ sendMail: vi.fn() }))

let f: Awaited<ReturnType<typeof makeTenant>>
const password = 'senha-forte-123'
const newPassword = 'outra-senha-456'

const createUser = (label: string) => addLoginUser(f, { label, password, mustChangePassword: true })

const requestReset = (email: string) => auth.api.requestPasswordReset({ body: { email, redirectTo: '/reset-password' } })

async function sentLink(to: string) {
  await vi.waitFor(() => expect(sendMail).toHaveBeenCalledWith(to, expect.any(String), expect.stringContaining('href=')))
  const html = vi.mocked(sendMail).mock.calls.find(([recipient]) => recipient === to)![2]
  return /href="([^"]+)"/.exec(html)![1]!.replaceAll('&amp;', '&')
}

beforeAll(async () => {
  f = await makeTenant(0)
})
beforeEach(() => vi.mocked(sendMail).mockClear())
afterAll(async () => {
  await f.cleanup()
  await db.$client.end()
})

describe('redefinição de senha por email', () => {
  it('o email enviado traz um link que devolve o token para a página de redefinição', async () => {
    const u = await createUser('link')

    await requestReset(u.email)

    const res = await auth.handler(new Request(await sentLink(u.email), { redirect: 'manual' }))
    const location = new URL(res.headers.get('location')!, process.env.BETTER_AUTH_URL)
    expect(location.pathname).toBe('/reset-password')
    expect(location.searchParams.get('token')).toBeTruthy()
  })

  it('o token troca a senha: a nova entra, a antiga não; sessões abertas caem e a troca obrigatória é dispensada', async () => {
    const u = await createUser('troca')
    await auth.api.signInEmail({ body: { email: u.email, password } })
    await requestReset(u.email)
    const link = await sentLink(u.email)
    const token = new URL(link).pathname.split('/').pop()!

    await auth.api.resetPassword({ body: { newPassword, token } })

    expect(await db.select().from(sessions).where(eq(sessions.userId, u.id))).toHaveLength(0)
    await expect(auth.api.signInEmail({ body: { email: u.email, password } })).rejects.toThrow()
    await expect(auth.api.signInEmail({ body: { email: u.email, password: newPassword } })).resolves.toBeTruthy()
    const [row] = await db.select().from(users).where(eq(users.id, u.id))
    expect(row!.mustChangePassword).toBe(false)
  })

  it('grava o evento com o usuário como ator e o tenant dele', async () => {
    const u = await createUser('audit')
    await requestReset(u.email)
    const token = new URL(await sentLink(u.email)).pathname.split('/').pop()!

    await auth.api.resetPassword({ body: { newPassword, token } })

    const events = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.tenantId, f.tenant.id), eq(auditEvents.entityId, u.id), eq(auditEvents.action, 'auth.password_reset')))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ actorId: u.id, actorName: 'audit', entityType: 'user', entityId: u.id, impersonatedBy: null })
  })

  it('email inexistente tem a mesma resposta e não envia nada', async () => {
    const known = await createUser('conhecido')

    const forKnown = await requestReset(known.email)
    await sentLink(known.email)
    vi.mocked(sendMail).mockClear()
    const forUnknown = await requestReset(`ninguem-${f.tenant.slug}@test.local`)
    await requestReset(known.email)
    await sentLink(known.email)

    expect(forUnknown).toEqual(forKnown)
    expect(vi.mocked(sendMail).mock.calls.map(([to]) => to)).toEqual([known.email])
  })
})
