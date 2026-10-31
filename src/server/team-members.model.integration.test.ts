import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { invitations, teamMembers, users } from '#/db/schema'
import { acceptInvitationCore } from './invitations.core'
import type { AuthCtx } from './roles'
import { addAdmin, addLoginUser, addTeam, addUser, joinTeam, makeTenant } from './test-fixtures'
import { createTenantAdminFor } from './tenants.core'
import { createUserFor, deactivateUserCore, updateUserCore } from './users.core'

const password = 'senha-forte-123'
let f: Awaited<ReturnType<typeof makeTenant>>
let teamB: Awaited<ReturnType<typeof addTeam>>
let admin: AuthCtx

beforeAll(async () => {
  f = await makeTenant(2)
  teamB = await addTeam(f, 'B')
  admin = await addAdmin(f)
})
afterAll(async () => {
  await f.cleanup()
  await db.$client.end()
})

const uniqueEmail = (label: string) => `${label}-${Math.random().toString(36).slice(2, 8)}@test.local`

const storedUser = async (userId: string) => (await db.select().from(users).where(eq(users.id, userId)))[0]!
const linksOf = (userId: string) =>
  db.select({ teamId: teamMembers.teamId, role: teamMembers.role }).from(teamMembers).where(eq(teamMembers.userId, userId))

describe('o vínculo vive só em team_members, e users guarda só o papel de tenant', () => {
  it('fixtures: líder é MEMBER de tenant com vínculo LEADER', async () => {
    const leaderInB = await addUser(f, { role: 'MEMBER', team: teamB, teamRole: 'LEADER' })
    const login = await addLoginUser(f, { label: 'login', password })

    expect(f.leader).toMatchObject({ role: 'MEMBER', memberships: [{ teamId: f.team.id, role: 'LEADER' }] })
    expect(leaderInB.memberships).toEqual([{ teamId: teamB.id, role: 'LEADER' }])
    expect(await linksOf(login.id)).toEqual([{ teamId: f.team.id, role: 'MEMBER' }])
  })

  it('createUserFor: papel de tenant em users.role e papel de equipe no vínculo', async () => {
    const leader = await createUserFor(admin, { name: 'L', email: uniqueEmail('l'), password, teamId: teamB.id, role: 'MEMBER', teamRole: 'LEADER' })
    const member = await createUserFor(admin, { name: 'M', email: uniqueEmail('m'), password, teamId: f.team.id, role: 'MEMBER' })
    const boss = await createUserFor(admin, { name: 'A', email: uniqueEmail('a'), password, teamId: teamB.id, role: 'TENANT_ADMIN' })
    const loose = await createUserFor(admin, { name: 'S', email: uniqueEmail('s'), password, teamId: null, role: 'MEMBER' })

    expect(await linksOf(leader.id)).toEqual([{ teamId: teamB.id, role: 'LEADER' }])
    expect(await linksOf(member.id)).toEqual([{ teamId: f.team.id, role: 'MEMBER' }])
    expect(await linksOf(boss.id)).toEqual([{ teamId: teamB.id, role: 'MEMBER' }])
    expect(await linksOf(loose.id)).toEqual([])
    expect(await storedUser(boss.id)).toMatchObject({ role: 'TENANT_ADMIN' })
    expect(await storedUser(leader.id)).toMatchObject({ role: 'MEMBER' })
  })

  describe('acceptInvitationCore', () => {
    const invite = async (values: Partial<typeof invitations.$inferInsert>) => {
      const email = uniqueEmail('conv')
      const token = `tok-${Math.random().toString(36).slice(2, 12)}`
      await db.insert(invitations).values({ tenantId: f.tenant.id, teamId: f.team.id, email, token, expiresAt: new Date(Date.now() + 60_000), ...values })
      return { token, email }
    }
    const accept = async (values: Partial<typeof invitations.$inferInsert>) => {
      const { token, email } = await invite(values)
      await acceptInvitationCore(token, 'Convidado', password)
      return (await db.select().from(users).where(eq(users.email, email)))[0]!
    }

    it('o papel de equipe do convite vira o vínculo e o papel de tenant vai para users.role', async () => {
      const leader = await accept({ teamId: teamB.id, role: 'MEMBER', teamRole: 'LEADER' })
      const member = await accept({ role: 'MEMBER' })

      expect(await linksOf(leader.id)).toEqual([{ teamId: teamB.id, role: 'LEADER' }])
      expect(await linksOf(member.id)).toEqual([{ teamId: f.team.id, role: 'MEMBER' }])
      expect(leader).toMatchObject({ role: 'MEMBER' })
    })

    it('convite sem equipe não cria vínculo', async () => {
      const loose = await accept({ teamId: null, role: 'MEMBER' })

      expect(await linksOf(loose.id)).toEqual([])
    })

    it('convite de admin com equipe vira MEMBER dela', async () => {
      const boss = await accept({ teamId: teamB.id, role: 'TENANT_ADMIN' })

      expect(boss).toMatchObject({ role: 'TENANT_ADMIN' })
      expect(await linksOf(boss.id)).toEqual([{ teamId: teamB.id, role: 'MEMBER' }])
    })
  })

  it('updateUserCore troca só o papel de tenant e deixa os vínculos como estão', async () => {
    const user = await addUser(f, { role: 'MEMBER', team: f.team })
    await joinTeam(f, user.userId, teamB, 'LEADER')

    await updateUserCore(admin, { userId: user.userId, role: 'TENANT_ADMIN' })

    expect(await storedUser(user.userId)).toMatchObject({ role: 'TENANT_ADMIN' })
    expect((await linksOf(user.userId)).sort((a, b) => a.role.localeCompare(b.role))).toEqual([
      { teamId: teamB.id, role: 'LEADER' },
      { teamId: f.team.id, role: 'MEMBER' },
    ])
  })

  it('createTenantAdminFor: admin do tenant nasce sem equipe e sem vínculo', async () => {
    const created = await createTenantAdminFor(admin, { tenantId: f.tenant.id, name: 'Admin Novo', email: uniqueEmail('adm'), password })

    expect(await linksOf(created.id)).toEqual([])
  })

  it('deactivateUserCore não mexe nos vínculos', async () => {
    const user = await addUser(f, { role: 'MEMBER', team: f.team, teamRole: 'LEADER' })

    await deactivateUserCore(admin, user.userId)

    expect(await linksOf(user.userId)).toEqual([{ teamId: f.team.id, role: 'LEADER' }])
  })
})
