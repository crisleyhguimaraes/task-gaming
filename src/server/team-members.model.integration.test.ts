import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { and, eq, or, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { invitations, teamMembers, users } from '#/db/schema'
import { acceptInvitationCore } from './invitations.core'
import type { AuthCtx } from './roles'
import { addAdmin, addLoginUser, addTeam, addUser, joinTeam, makeTenant } from './test-fixtures'
import { createTenantAdminFor } from './tenants.core'
import { createUserFor, deactivateUserCore, updateUserCore } from './users.core'

const password = 'senha-forte-123'
const STATEMENT_BREAKPOINT = '--> statement-breakpoint'
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

const usersWithLegacy = () =>
  db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.tenantId, f.tenant.id), or(sql`${users.teamId} is not null`, eq(users.role, 'TEAM_LEADER'))))

describe('o vínculo vive só em team_members, e users guarda só o papel de tenant', () => {
  it('fixtures: líder é MEMBER de tenant com vínculo LEADER; addUser e addLoginUser não gravam o legado', async () => {
    const leaderInB = await addUser(f, { role: 'MEMBER', team: teamB, teamRole: 'LEADER' })
    const login = await addLoginUser(f, { label: 'login', password })

    expect(f.leader).toMatchObject({ role: 'MEMBER', memberships: [{ teamId: f.team.id, role: 'LEADER' }] })
    expect(leaderInB.memberships).toEqual([{ teamId: teamB.id, role: 'LEADER' }])
    expect(await linksOf(login.id)).toEqual([{ teamId: f.team.id, role: 'MEMBER' }])
    expect(await usersWithLegacy()).toEqual([])
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
    expect(await storedUser(boss.id)).toMatchObject({ role: 'TENANT_ADMIN', teamId: null })
    expect(await storedUser(leader.id)).toMatchObject({ role: 'MEMBER', teamId: null })
    expect(await usersWithLegacy()).toEqual([])
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
      expect(leader).toMatchObject({ role: 'MEMBER', teamId: null })
      expect(await usersWithLegacy()).toEqual([])
    })

    it('convite sem equipe não cria vínculo', async () => {
      const loose = await accept({ teamId: null, role: 'MEMBER' })

      expect(await linksOf(loose.id)).toEqual([])
    })

    it('convite de admin com equipe vira MEMBER dela', async () => {
      const boss = await accept({ teamId: teamB.id, role: 'TENANT_ADMIN' })

      expect(boss).toMatchObject({ role: 'TENANT_ADMIN', teamId: null })
      expect(await linksOf(boss.id)).toEqual([{ teamId: teamB.id, role: 'MEMBER' }])
    })

    it('convite antigo com role TEAM_LEADER ainda é aceitável: MEMBER de tenant e LEADER da equipe', async () => {
      const leader = await accept({ teamId: teamB.id, role: 'TEAM_LEADER' })

      expect(leader).toMatchObject({ role: 'MEMBER', teamId: null })
      expect(await linksOf(leader.id)).toEqual([{ teamId: teamB.id, role: 'LEADER' }])
    })
  })

  it('updateUserCore troca só o papel de tenant e deixa os vínculos como estão', async () => {
    const user = await addUser(f, { role: 'MEMBER', team: f.team })
    await joinTeam(f, user.userId, teamB, 'LEADER')

    await updateUserCore(admin, { userId: user.userId, role: 'TENANT_ADMIN' })

    expect(await storedUser(user.userId)).toMatchObject({ role: 'TENANT_ADMIN', teamId: null })
    expect((await linksOf(user.userId)).sort((a, b) => a.role.localeCompare(b.role))).toEqual([
      { teamId: teamB.id, role: 'LEADER' },
      { teamId: f.team.id, role: 'MEMBER' },
    ])
  })

  it('createTenantAdminFor: admin do tenant nasce sem equipe e sem vínculo', async () => {
    const created = await createTenantAdminFor(admin, { tenantId: f.tenant.id, name: 'Admin Novo', email: uniqueEmail('adm'), password })

    expect(await linksOf(created.id)).toEqual([])
    expect(await usersWithLegacy()).toEqual([])
  })

  it('deactivateUserCore não mexe nos vínculos', async () => {
    const user = await addUser(f, { role: 'MEMBER', team: f.team, teamRole: 'LEADER' })

    await deactivateUserCore(admin, user.userId)

    expect(await linksOf(user.userId)).toEqual([{ teamId: f.team.id, role: 'LEADER' }])
  })
})

describe('migração 0013: convites pendentes de líder', () => {
  function backfillStatement() {
    const dir = join(process.cwd(), 'drizzle')
    const file = readdirSync(dir).find((name) => name.startsWith('0013_'))
    const statement = file && readFileSync(join(dir, file), 'utf8').split(STATEMENT_BREAKPOINT).find((s) => s.includes('UPDATE "invitations"'))
    if (!statement) throw new Error('A migração 0013 não tem o UPDATE do backfill')
    return statement
  }

  it('TEAM_LEADER vira MEMBER com team_role LEADER; os demais convites ficam como estão', async () => {
    const make = async (label: string, role: 'TEAM_LEADER' | 'MEMBER' | 'TENANT_ADMIN') => {
      const token = `tok-${label}-${f.tenant.slug}`
      await db.insert(invitations).values({ tenantId: f.tenant.id, teamId: f.team.id, email: `${label}-${f.tenant.slug}@test.local`, role, token, expiresAt: new Date(Date.now() + 60_000) })
      return token
    }
    const tokens = [await make('mig-lider', 'TEAM_LEADER'), await make('mig-membro', 'MEMBER'), await make('mig-admin', 'TENANT_ADMIN')]

    await db.execute(sql.raw(backfillStatement()))

    const rows = await Promise.all(tokens.map(async (token) => (await db.select().from(invitations).where(eq(invitations.token, token)))[0]!))
    expect(rows.map((r) => [r.role, r.teamRole])).toEqual([
      ['MEMBER', 'LEADER'],
      ['MEMBER', 'MEMBER'],
      ['TENANT_ADMIN', 'MEMBER'],
    ])
  })
})
