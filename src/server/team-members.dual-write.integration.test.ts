import { and, eq, ne } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { invitations, teamMembers, users } from '#/db/schema'
import { acceptInvitationCore } from './invitations.core'
import { createTenantAdminFor } from './tenants.core'
import { teamRoleOf } from './team-members.core'
import type { AuthCtx } from './roles'
import { addAdmin, addTeam, addUser, makeTenant } from './test-fixtures'
import { createUserFor, deactivateUserCore, updateUserCore } from './users.core'

const password = 'senha-forte-123'
let f: Awaited<ReturnType<typeof makeTenant>>
let teamB: Awaited<ReturnType<typeof addTeam>>
let admin: AuthCtx

beforeEach(async () => {
  f = await makeTenant(2)
  teamB = await addTeam(f, 'B')
  admin = await addAdmin(f)
})
afterEach(() => f.cleanup())
afterAll(() => db.$client.end())

const uniqueEmail = (label: string) => `${label}-${Math.random().toString(36).slice(2, 8)}@test.local`

/** Enquanto o legado e `team_members` convivem: todo não-SUPER_ADMIN com `users.team_id` tem exatamente um vínculo igual, e ninguém mais tem vínculo. */
async function expectedLinks(tenantId: string) {
  const legacy = await db.select().from(users).where(and(eq(users.tenantId, tenantId), ne(users.role, 'SUPER_ADMIN')))
  return legacy.filter((u) => u.teamId).map((u) => `${u.id}:${u.teamId}:${teamRoleOf(u.role)}`).sort()
}

async function actualLinks(tenantId: string) {
  const rows = await db.select().from(teamMembers).where(eq(teamMembers.tenantId, tenantId))
  return rows.map((l) => `${l.userId}:${l.teamId}:${l.role}`).sort()
}

const expectConsistent = async () => expect(await actualLinks(f.tenant.id)).toEqual(await expectedLinks(f.tenant.id))

describe('invariante do dual-write: users.team_id/role e team_members andam juntos', () => {
  it('fixtures: líder, membros, admin e usuário sem equipe', async () => {
    await addUser(f, { role: 'MEMBER', team: null })
    await addUser(f, { role: 'TEAM_LEADER', team: teamB })

    await expectConsistent()
    expect((await actualLinks(f.tenant.id)).length).toBeGreaterThan(0)
  })

  it('createUserFor: membro, líder e admin com equipe, e usuário sem equipe', async () => {
    await createUserFor(admin, { name: 'M', email: uniqueEmail('m'), password, teamId: f.team.id, role: 'MEMBER' })
    await createUserFor(admin, { name: 'L', email: uniqueEmail('l'), password, teamId: teamB.id, role: 'TEAM_LEADER' })
    await createUserFor(admin, { name: 'A', email: uniqueEmail('a'), password, teamId: teamB.id, role: 'TENANT_ADMIN' })
    await createUserFor(admin, { name: 'S', email: uniqueEmail('s'), password, teamId: null, role: 'MEMBER' })

    await expectConsistent()
  })

  describe('acceptInvitationCore', () => {
    const invite = async (teamId: string | null, role: 'MEMBER' | 'TEAM_LEADER') => {
      const email = uniqueEmail('conv')
      const token = `tok-${Math.random().toString(36).slice(2, 12)}`
      await db.insert(invitations).values({ tenantId: f.tenant.id, teamId, email, role, token, expiresAt: new Date(Date.now() + 60_000) })
      return token
    }

    it('o papel do convite vira o papel de equipe', async () => {
      await acceptInvitationCore(await invite(f.team.id, 'MEMBER'), 'Convidado', password)
      await acceptInvitationCore(await invite(teamB.id, 'TEAM_LEADER'), 'Convidada', password)

      await expectConsistent()
    })

    it('convite sem equipe não cria vínculo', async () => {
      await acceptInvitationCore(await invite(null, 'MEMBER'), 'Solto', password)

      await expectConsistent()
    })
  })

  describe('updateUserCore', () => {
    const update = (userId: string, teamId: string | null, role: 'TENANT_ADMIN' | 'TEAM_LEADER' | 'MEMBER') => updateUserCore(admin, { userId, teamId, role })

    it('trocar de equipe remove o vínculo antigo e cria o novo', async () => {
      const u = await addUser(f, { role: 'MEMBER', team: f.team })

      await update(u.userId, teamB.id, 'MEMBER')

      await expectConsistent()
      expect(await actualLinks(f.tenant.id)).toContain(`${u.userId}:${teamB.id}:MEMBER`)
    })

    it('promover e rebaixar na mesma equipe troca o papel sem duplicar', async () => {
      const u = await addUser(f, { role: 'MEMBER', team: f.team })

      await update(u.userId, f.team.id, 'TEAM_LEADER')
      await expectConsistent()
      expect(await actualLinks(f.tenant.id)).toContain(`${u.userId}:${f.team.id}:LEADER`)

      await update(u.userId, f.team.id, 'MEMBER')
      await expectConsistent()
    })

    it('ficar sem equipe remove o vínculo e voltar a ter equipe cria de novo', async () => {
      const u = await addUser(f, { role: 'TEAM_LEADER', team: f.team })

      await update(u.userId, null, 'TEAM_LEADER')
      await expectConsistent()
      expect((await db.select().from(teamMembers).where(eq(teamMembers.userId, u.userId)))).toHaveLength(0)

      await update(u.userId, teamB.id, 'TEAM_LEADER')
      await expectConsistent()
    })

    it('admin com equipe vira MEMBER dela e continua assim ao trocar de equipe', async () => {
      const a = await addUser(f, { role: 'TENANT_ADMIN', team: f.team })

      await update(a.userId, teamB.id, 'TENANT_ADMIN')

      await expectConsistent()
      expect(await actualLinks(f.tenant.id)).toContain(`${a.userId}:${teamB.id}:MEMBER`)
    })

    it('repetir a mesma atribuição não muda nada', async () => {
      const u = await addUser(f, { role: 'MEMBER', team: f.team })
      const before = await actualLinks(f.tenant.id)

      await update(u.userId, f.team.id, 'MEMBER')

      expect(await actualLinks(f.tenant.id)).toEqual(before)
    })
  })

  it('createTenantAdminFor: admin do tenant nasce sem equipe e sem vínculo', async () => {
    const created = await createTenantAdminFor(admin, { tenantId: f.tenant.id, name: 'Admin Novo', email: uniqueEmail('adm'), password })

    expect(await db.select().from(teamMembers).where(eq(teamMembers.userId, created.id))).toHaveLength(0)
    await expectConsistent()
  })

  it('deactivateUserCore: desativar não mexe nos vínculos', async () => {
    const u = await addUser(f, { role: 'MEMBER', team: f.team })
    const before = await actualLinks(f.tenant.id)

    await deactivateUserCore(admin, u.userId)

    expect(await actualLinks(f.tenant.id)).toEqual(before)
    await expectConsistent()
  })
})
