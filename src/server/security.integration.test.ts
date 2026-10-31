import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { users } from '#/db/schema'
import { auth } from '#/lib/auth'
import { addLoginUser, makeTenant } from './test-fixtures'

let mine: Awaited<ReturnType<typeof makeTenant>>
let other: Awaited<ReturnType<typeof makeTenant>>
const password = 'senha-forte-123'

async function memberCookie(label: string) {
  const { email } = await addLoginUser(mine, { label, password, mustChangePassword: true })
  const { headers } = await auth.api.signInEmail({ body: { email, password }, returnHeaders: true })
  return headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
}

const updateUserHttp = (cookie: string, body: object) =>
  auth.handler(
    new Request(`${process.env.BETTER_AUTH_URL}/api/auth/update-user`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', origin: process.env.BETTER_AUTH_URL! },
      body: JSON.stringify(body),
    }),
  )

beforeAll(async () => {
  mine = await makeTenant(0)
  other = await makeTenant(0)
})
afterAll(async () => {
  await mine.cleanup()
  await other.cleanup()
  await db.$client.end()
})

describe('/api/auth/update-user', () => {
  it('não deixa o próprio usuário trocar de tenant, equipe nem pular a troca de senha', async () => {
    const email = `escalada-${mine.tenant.slug}@test.local`
    const cookie = await memberCookie('escalada')

    const res = await updateUserHttp(cookie, { tenantId: other.tenant.id, teamId: other.team.id, mustChangePassword: false })

    expect(res.status).toBe(400)
    const [u] = await db.select().from(users).where(eq(users.email, email))
    expect(u).toMatchObject({ tenantId: mine.tenant.id, teamId: mine.team.id, mustChangePassword: true })
  })

  it('continua aceitando campos comuns, como o nome', async () => {
    const cookie = await memberCookie('nome')

    const res = await updateUserHttp(cookie, { name: 'Outro Nome' })

    expect(res.status).toBe(200)
  })
})
