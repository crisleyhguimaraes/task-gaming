import { afterAll, describe, expect, it, vi } from 'vitest'
import { db } from '#/db'
import { auth } from '#/lib/auth'

vi.mock('./mail', () => ({ sendMail: vi.fn() }))

const post = (path: string, ip: string, body: object) =>
  auth.handler(
    new Request(`${process.env.BETTER_AUTH_URL}/api/auth${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: process.env.BETTER_AUTH_URL!, 'x-forwarded-for': ip },
      body: JSON.stringify(body),
    }),
  )

const statuses = async (attempts: number, send: () => Promise<Response>) => {
  const out: Array<number> = []
  for (let i = 0; i < attempts; i++) out.push((await send()).status)
  return out
}

const signIn = (ip: string) => post('/sign-in/email', ip, { email: 'ninguem@test.local', password: 'errada-12345' })
const requestReset = (ip: string) => post('/request-password-reset', ip, { email: 'ninguem@test.local' })

afterAll(() => db.$client.end())

describe('rate limit do Better Auth', () => {
  it('login: a sexta tentativa no mesmo minuto vem como 429', async () => {
    const result = await statuses(6, () => signIn('10.0.0.1'))

    expect(result.slice(0, 5)).not.toContain(429)
    expect(result[5]).toBe(429)
  })

  it('o limite é por origem: outro IP continua passando', async () => {
    await statuses(6, () => signIn('10.0.0.2'))

    expect((await signIn('10.0.0.3')).status).not.toBe(429)
  })

  it('pedido de reset: o quarto na janela vem como 429', async () => {
    const result = await statuses(4, () => requestReset('10.0.0.4'))

    expect(result.slice(0, 3)).toEqual([200, 200, 200])
    expect(result[3]).toBe(429)
  })

  it('chamadas diretas a auth.api não passam pelo limite', async () => {
    for (let i = 0; i < 8; i++) {
      await expect(auth.api.signInEmail({ body: { email: 'ninguem@test.local', password: 'errada-12345' } })).rejects.toMatchObject({ status: 'UNAUTHORIZED' })
    }
  })
})
