import { and, asc, eq } from 'drizzle-orm'
import { symmetricDecrypt } from 'better-auth/crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { auditEvents, sessions, tenants, twoFactors, users } from '#/db/schema'
import { auth } from '#/lib/auth'
import type { AuthCtx } from './roles'
import { makeTenant } from './test-fixtures'
import { twoFactorStatusFor } from './two-factor.core'

let f: Awaited<ReturnType<typeof makeTenant>>
const password = 'senha-forte-123'

const cookiePairs = (headers: Headers) => headers.getSetCookie().map((c) => c.split(';')[0]!)

function jar(...pairs: Array<Array<string>>) {
  const byName = new Map<string, string>()
  for (const pair of pairs.flat()) byName.set(pair.split('=')[0]!, pair)
  return new Headers({ cookie: [...byName.values()].join('; ') })
}

async function createUser(label: string) {
  const email = `${label}-${f.tenant.slug}@test.local`
  const { user } = await auth.api.createUser({
    body: { name: label, email, password, role: 'MEMBER', data: { tenantId: f.tenant.id, teamId: f.team.id, mustChangePassword: false } },
  })
  return { id: user.id, email }
}

async function currentTotp(userId: string) {
  const [row] = await db.select().from(twoFactors).where(eq(twoFactors.userId, userId))
  const secret = await symmetricDecrypt({ key: (await auth.$context).secretConfig, data: row!.secret })
  return (await auth.api.generateTOTP({ body: { secret } })).code
}

const wrongCode = (valid: string) => String((Number(valid) + 1) % 1_000_000).padStart(6, '0')

async function signInPassword(email: string) {
  const { headers, response } = await auth.api.signInEmail({ body: { email, password }, returnHeaders: true })
  return { cookies: cookiePairs(headers), response }
}

async function enableTotp(session: Headers) {
  const res = await auth.api.enableTwoFactor({ body: { password }, headers: session })
  if (res.method !== 'totp') throw new Error('esperava o método totp')
  return res
}

async function userWithTwoFactor(label: string) {
  const user = await createUser(label)
  const { cookies } = await signInPassword(user.email)
  const { backupCodes } = await enableTotp(jar(cookies))
  const { headers } = await auth.api.verifyTOTP({ body: { code: await currentTotp(user.id) }, headers: jar(cookies), returnHeaders: true })
  return { ...user, backupCodes, session: jar(cookies, cookiePairs(headers)) }
}

const userActions = async (userId: string) =>
  (await db.select().from(auditEvents).where(and(eq(auditEvents.tenantId, f.tenant.id), eq(auditEvents.entityId, userId))).orderBy(asc(auditEvents.createdAt))).map((e) => e.action)

const isEnabled = async (userId: string) => (await db.select().from(users).where(eq(users.id, userId)))[0]!.twoFactorEnabled

beforeAll(async () => {
  f = await makeTenant(1)
})
afterAll(async () => {
  await f.cleanup()
  await db.$client.end()
})

describe('2FA TOTP: cadastro', () => {
  it('só vale depois de confirmar um código do app, e registra a ativação', async () => {
    const u = await createUser('cadastro')
    const { cookies } = await signInPassword(u.email)
    const session = jar(cookies)

    const { totpURI, backupCodes } = await enableTotp(session)

    expect(totpURI).toMatch(/^otpauth:\/\/totp\//)
    expect(backupCodes.length).toBeGreaterThan(0)
    expect(await isEnabled(u.id)).toBe(false)
    const valid = await currentTotp(u.id)
    await expect(auth.api.verifyTOTP({ body: { code: wrongCode(valid) }, headers: session })).rejects.toThrow()
    expect(await isEnabled(u.id)).toBe(false)

    await auth.api.verifyTOTP({ body: { code: valid }, headers: session })

    expect(await isEnabled(u.id)).toBe(true)
    expect(await userActions(u.id)).toEqual(['auth.login', 'auth.two_factor_enabled'])
  })

  it('exige a senha para começar', async () => {
    const u = await createUser('senha-cadastro')
    const { cookies } = await signInPassword(u.email)

    await expect(auth.api.enableTwoFactor({ body: { password: 'errada-12345' }, headers: jar(cookies) })).rejects.toThrow()
  })
})

describe('2FA TOTP: login', () => {
  it('a senha sozinha não abre sessão nem derruba as outras, e o login só é registrado no segundo passo', async () => {
    const u = await userWithTwoFactor('login')
    const before = await db.select().from(sessions).where(eq(sessions.userId, u.id))

    const { cookies, response } = await signInPassword(u.email)

    expect(response).toMatchObject({ twoFactorRedirect: true })
    expect(cookies.filter((c) => c.includes('session_token')).every((c) => c.endsWith('='))).toBe(true)
    expect(await db.select().from(sessions).where(eq(sessions.userId, u.id))).toHaveLength(before.length)
    expect(await userActions(u.id)).toEqual(['auth.login', 'auth.two_factor_enabled'])

    await auth.api.verifyTOTP({ body: { code: await currentTotp(u.id) }, headers: jar(cookies) })

    expect(await userActions(u.id)).toEqual(['auth.login', 'auth.two_factor_enabled', 'auth.login'])
    expect(await db.select().from(sessions).where(eq(sessions.userId, u.id))).toHaveLength(1)
  })

  it('código errado no segundo passo não abre sessão', async () => {
    const u = await userWithTwoFactor('errado')
    const { cookies } = await signInPassword(u.email)

    await expect(auth.api.verifyTOTP({ body: { code: wrongCode(await currentTotp(u.id)) }, headers: jar(cookies) })).rejects.toThrow()

    expect(await db.select().from(sessions).where(eq(sessions.userId, u.id))).toHaveLength(1)
  })

  it('código de recuperação entra uma vez só', async () => {
    const u = await userWithTwoFactor('recuperacao')
    const [recoveryCode] = u.backupCodes

    const first = await signInPassword(u.email)
    await auth.api.verifyBackupCode({ body: { code: recoveryCode! }, headers: jar(first.cookies) })
    const second = await signInPassword(u.email)

    await expect(auth.api.verifyBackupCode({ body: { code: recoveryCode! }, headers: jar(second.cookies) })).rejects.toThrow()
  })
})

describe('2FA TOTP: desativação', () => {
  it('pede a senha, apaga o segredo, volta ao login simples e registra', async () => {
    const u = await userWithTwoFactor('desativa')

    await expect(auth.api.disableTwoFactor({ body: { password: 'errada-12345' }, headers: u.session })).rejects.toThrow()
    expect(await isEnabled(u.id)).toBe(true)

    await auth.api.disableTwoFactor({ body: { password }, headers: u.session })

    expect(await isEnabled(u.id)).toBe(false)
    expect(await db.select().from(twoFactors).where(eq(twoFactors.userId, u.id))).toHaveLength(0)
    expect((await signInPassword(u.email)).response).not.toHaveProperty('twoFactorRedirect')
    expect(await userActions(u.id)).toEqual(['auth.login', 'auth.two_factor_enabled', 'auth.two_factor_disabled', 'auth.login'])
  })
})

describe('twoFactorStatusFor: imposição por tenant', () => {
  const member = (): AuthCtx => f.members[0]!
  const requireInTenant = (requireTwoFactor: boolean) => db.update(tenants).set({ requireTwoFactor }).where(eq(tenants.id, f.tenant.id))
  const enableInDb = (twoFactorEnabled: boolean) => db.update(users).set({ twoFactorEnabled }).where(eq(users.id, member().userId))

  it('tenant que não exige nunca pendencia o cadastro', async () => {
    await requireInTenant(false)

    expect(await twoFactorStatusFor(member())).toEqual({ enabled: false, required: false, setupPending: false })
  })

  it('tenant que exige pendencia quem ainda não ativou', async () => {
    await requireInTenant(true)
    await enableInDb(false)

    expect(await twoFactorStatusFor(member())).toEqual({ enabled: false, required: true, setupPending: true })
  })

  it('quem já ativou segue livre', async () => {
    await requireInTenant(true)
    await enableInDb(true)

    expect(await twoFactorStatusFor(member())).toEqual({ enabled: true, required: true, setupPending: false })
  })

  it('quem está sendo impersonado não é barrado', async () => {
    await requireInTenant(true)
    await enableInDb(false)

    expect((await twoFactorStatusFor({ ...member(), impersonatedBy: 'super' })).setupPending).toBe(false)
  })
})
