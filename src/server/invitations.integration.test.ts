import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { invitations, users } from '#/db/schema'
import { acceptInvitationCore, validInvitation } from './invitations.core'
import { makeTenant } from './test-fixtures'

let f: Awaited<ReturnType<typeof makeTenant>>
beforeAll(async () => {
  f = await makeTenant(0)
})
afterAll(async () => {
  await f.cleanup()
  await db.$client.end()
})

describe('convites', () => {
  it('aceitar cria usuário no tenant/equipe/papel do convite e invalida o token', async () => {
    const email = `nova-${f.tenant.slug}@test.local`
    const [inv] = await db
      .insert(invitations)
      .values({ tenantId: f.tenant.id, teamId: f.team.id, email, role: 'MEMBER', token: `tok-${f.tenant.slug}-1`, expiresAt: new Date(Date.now() + 60_000) })
      .returning()
    expect((await validInvitation(inv!.token)).status).toBe('valid')
    await acceptInvitationCore(inv!.token, 'Nova Pessoa', 'senha-forte-123')
    const [u] = await db.select().from(users).where(eq(users.email, email))
    expect(u).toMatchObject({ tenantId: f.tenant.id, teamId: f.team.id, role: 'MEMBER', mustChangePassword: false })
    expect((await validInvitation(inv!.token)).status).toBe('accepted')
    await expect(acceptInvitationCore(inv!.token, 'X', 'senha-forte-123')).rejects.toThrow(/inválido/)
  })

  it('expirado e inexistente', async () => {
    const [inv] = await db
      .insert(invitations)
      .values({ tenantId: f.tenant.id, teamId: null, email: `velha-${f.tenant.slug}@test.local`, role: 'MEMBER', token: `tok-${f.tenant.slug}-2`, expiresAt: new Date(Date.now() - 1) })
      .returning()
    expect((await validInvitation(inv!.token)).status).toBe('expired')
    expect((await validInvitation('nope')).status).toBe('invalid')
  })
})
