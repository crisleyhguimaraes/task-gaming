import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { teamMembers, teams, tenants, users } from '#/db/schema'
import { addTeam, addUser, makeTenant } from './test-fixtures'

const FOREIGN_KEY_VIOLATION = '23503'

afterAll(() => db.$client.end())

describe('FK composta de team_members', () => {
  it('rejeita usuário de um tenant em equipe de outro, nos dois sentidos', async () => {
    const a = await makeTenant(0)
    const b = await makeTenant(0)
    try {
      const inA = await addUser(a, { role: 'MEMBER', team: null })
      const inB = await addUser(b, { role: 'MEMBER', team: null })

      const userAInTeamB = db.insert(teamMembers).values({ teamId: b.team.id, userId: inA.userId, tenantId: b.tenant.id })
      const userBInTeamA = db.insert(teamMembers).values({ teamId: a.team.id, userId: inB.userId, tenantId: a.tenant.id })
      const claimingOwnTenant = db.insert(teamMembers).values({ teamId: b.team.id, userId: inA.userId, tenantId: a.tenant.id })

      await expect(userAInTeamB).rejects.toMatchObject({ cause: { code: FOREIGN_KEY_VIOLATION } })
      await expect(userBInTeamA).rejects.toMatchObject({ cause: { code: FOREIGN_KEY_VIOLATION } })
      await expect(claimingOwnTenant).rejects.toMatchObject({ cause: { code: FOREIGN_KEY_VIOLATION } })
    } finally {
      await a.cleanup()
      await b.cleanup()
    }
  })

  it('apagar o tenant leva os vínculos junto, sem a FK para teams barrar a cascata', async () => {
    const f = await makeTenant(1)
    const extra = await addTeam(f, 'Extra')
    await db.insert(teamMembers).values({ teamId: extra.id, userId: f.members[0]!.userId, tenantId: f.tenant.id })

    await expect(f.cleanup()).resolves.toBeDefined()

    expect(await db.select().from(tenants).where(eq(tenants.id, f.tenant.id))).toHaveLength(0)
    expect(await db.select().from(teamMembers).where(eq(teamMembers.tenantId, f.tenant.id))).toHaveLength(0)
  })

  it('apagar a equipe leva o vínculo e preserva a pessoa', async () => {
    const f = await makeTenant(1)
    try {
      const extra = await addTeam(f, 'Extra')
      const member = f.members[0]!
      await db.insert(teamMembers).values({ teamId: extra.id, userId: member.userId, tenantId: f.tenant.id })

      await db.delete(teams).where(eq(teams.id, extra.id))

      expect(await db.select().from(teamMembers).where(eq(teamMembers.teamId, extra.id))).toHaveLength(0)
      expect(await db.select({ id: users.id }).from(users).where(eq(users.id, member.userId))).toHaveLength(1)
    } finally {
      await f.cleanup()
    }
  })
})
