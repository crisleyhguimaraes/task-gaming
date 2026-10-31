import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { invitations, teamMembers, users } from '#/db/schema'
import { acceptInvitationCore, listInvitationsFor, validInvitation } from './invitations.core'
import { ForbiddenError } from './roles'
import { addAdmin, addTeam, addUser, makeTenant } from './test-fixtures'

let f: Awaited<ReturnType<typeof makeTenant>>
beforeAll(async () => {
  f = await makeTenant(0)
})
afterAll(async () => {
  await f.cleanup()
  await db.$client.end()
})

describe('convites', () => {
  it('aceitar cria usuário no tenant, o vínculo com a equipe do convite e invalida o token', async () => {
    const email = `nova-${f.tenant.slug}@test.local`
    const [inv] = await db
      .insert(invitations)
      .values({ tenantId: f.tenant.id, teamId: f.team.id, email, role: 'MEMBER', token: `tok-${f.tenant.slug}-1`, expiresAt: new Date(Date.now() + 60_000) })
      .returning()
    expect((await validInvitation(inv!.token)).status).toBe('valid')
    await acceptInvitationCore(inv!.token, 'Nova Pessoa', 'senha-forte-123')
    const [u] = await db.select().from(users).where(eq(users.email, email))
    expect(u).toMatchObject({ tenantId: f.tenant.id, role: 'MEMBER', mustChangePassword: false })
    expect(await db.select({ teamId: teamMembers.teamId, role: teamMembers.role }).from(teamMembers).where(eq(teamMembers.userId, u!.id))).toEqual([{ teamId: f.team.id, role: 'MEMBER' }])
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

describe('listagem de convites', () => {
  const pendingFor = async (teamId: string) => {
    const [inv] = await db
      .insert(invitations)
      .values({ tenantId: f.tenant.id, teamId, email: `pend-${teamId}@test.local`, role: 'MEMBER', token: `tok-${teamId}`, expiresAt: new Date(Date.now() + 60_000) })
      .returning()
    return inv!.email
  }
  const emailsFor = async (me: Parameters<typeof listInvitationsFor>[0]) => (await listInvitationsFor(me)).map((i) => i.email)

  it('o líder vê só os convites da equipe, o admin vê o tenant e quem não gerencia convites é recusado', async () => {
    const teamB = await addTeam(f, 'B')
    const [mine, theirs] = [await pendingFor(f.team.id), await pendingFor(teamB.id)]

    expect(await emailsFor(f.leader)).toEqual([mine])
    expect(await emailsFor(await addAdmin(f))).toEqual(expect.arrayContaining([mine, theirs]))
    await expect(listInvitationsFor(await addUser(f, { role: 'MEMBER', team: f.team }))).rejects.toThrow(ForbiddenError)
  })

  it('usuário sem equipe com permissão de convidar vê lista vazia, sem erro', async () => {
    const teamless = { ...(await addUser(f, { role: 'MEMBER', team: null })), capabilityOverrides: { MEMBER: { 'invitation.manage': true } } }

    expect(await listInvitationsFor(teamless)).toEqual([])
  })
})
