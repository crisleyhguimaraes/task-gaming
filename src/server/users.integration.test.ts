import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { invitations, users } from '#/db/schema'
import { createInvitationCore } from './invitations.core'
import type { AuthCtx } from './roles'
import { addAdmin, makeTenant } from './test-fixtures'
import { updateUserCore } from './users.core'

let mine: Awaited<ReturnType<typeof makeTenant>>
let other: Awaited<ReturnType<typeof makeTenant>>
let admin: AuthCtx

beforeAll(async () => {
  mine = await makeTenant(1)
  other = await makeTenant(0)
  admin = await addAdmin(mine)
})
afterAll(async () => {
  await mine.cleanup()
  await other.cleanup()
  await db.$client.end()
})

describe('updateUserCore', () => {
  it('muda papel e equipe de outro usuário do tenant', async () => {
    const member = mine.members[0]!

    await updateUserCore(admin, { userId: member.userId, teamId: null, role: 'TEAM_LEADER' })

    const [u] = await db.select().from(users).where(eq(users.id, member.userId))
    expect(u).toMatchObject({ teamId: null, role: 'TEAM_LEADER' })
  })

  it('recusa equipe de outro tenant', async () => {
    const member = mine.members[0]!

    await expect(updateUserCore(admin, { userId: member.userId, teamId: other.team.id, role: 'MEMBER' })).rejects.toThrow('Equipe não encontrada')

    const [u] = await db.select().from(users).where(eq(users.id, member.userId))
    expect(u!.teamId).not.toBe(other.team.id)
  })

  it('admin não altera o próprio papel, para o tenant nunca ficar sem admin', async () => {
    await expect(updateUserCore(admin, { userId: admin.userId, teamId: admin.teamId, role: 'MEMBER' })).rejects.toThrow('próprio papel')

    const [u] = await db.select().from(users).where(eq(users.id, admin.userId))
    expect(u!.role).toBe('TENANT_ADMIN')
  })

  it('admin ainda pode mudar a própria equipe', async () => {
    await updateUserCore(admin, { userId: admin.userId, teamId: null, role: 'TENANT_ADMIN' })

    const [u] = await db.select().from(users).where(eq(users.id, admin.userId))
    expect(u!.teamId).toBeNull()
  })
})

describe('createInvitationCore', () => {
  it('recusa equipe de outro tenant e não grava convite', async () => {
    const email = `convidado-${mine.tenant.slug}@test.local`

    await expect(createInvitationCore(admin, { email, teamId: other.team.id, role: 'MEMBER' })).rejects.toThrow('Equipe não encontrada')

    const rows = await db.select().from(invitations).where(eq(invitations.email, email))
    expect(rows).toHaveLength(0)
  })

  it('aceita equipe do próprio tenant', async () => {
    const email = `ok-${mine.tenant.slug}@test.local`

    const inv = await createInvitationCore(admin, { email, teamId: mine.team.id, role: 'MEMBER' })

    expect(inv).toMatchObject({ tenantId: mine.tenant.id, teamId: mine.team.id })
  })
})
