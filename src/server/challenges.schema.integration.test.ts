import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { challengeTeams, challenges, teams } from '#/db/schema'
import { addTeam, makeTenant } from './test-fixtures'

const FOREIGN_KEY_VIOLATION = '23503'
const SECONDS_PER_MINUTE = 60

afterAll(() => db.$client.end())

const newChallenge = async (f: Awaited<ReturnType<typeof makeTenant>>) => {
  const [c] = await db
    .insert(challenges)
    .values({ tenantId: f.tenant.id, teamId: f.team.id, title: 'Desafio', estimatedSeconds: 5 * SECONDS_PER_MINUTE })
    .returning()
  return c!
}

describe('challenge_teams', () => {
  it('o desafio nasce restrito às equipes (tenant_wide falso)', async () => {
    const f = await makeTenant(0)
    try {
      expect((await newChallenge(f)).tenantWide).toBe(false)
    } finally {
      await f.cleanup()
    }
  })

  it('rejeita equipe de um tenant em desafio de outro, nos dois sentidos', async () => {
    const a = await makeTenant(0)
    const b = await makeTenant(0)
    try {
      const challengeA = await newChallenge(a)

      const foreignTeam = db.insert(challengeTeams).values({ challengeId: challengeA.id, teamId: b.team.id, tenantId: a.tenant.id })
      const foreignTenant = db.insert(challengeTeams).values({ challengeId: challengeA.id, teamId: a.team.id, tenantId: b.tenant.id })

      await expect(foreignTeam).rejects.toMatchObject({ cause: { code: FOREIGN_KEY_VIOLATION } })
      await expect(foreignTenant).rejects.toMatchObject({ cause: { code: FOREIGN_KEY_VIOLATION } })
    } finally {
      await a.cleanup()
      await b.cleanup()
    }
  })

  it('apagar a equipe ou o desafio leva o vínculo junto', async () => {
    const f = await makeTenant(0)
    try {
      const [withTeam, withChallenge] = [await addTeam(f), await addTeam(f)]
      const challenge = await newChallenge(f)
      const link = (teamId: string) => db.insert(challengeTeams).values({ challengeId: challenge.id, teamId, tenantId: f.tenant.id })
      await link(withTeam.id)
      await link(withChallenge.id)

      await db.delete(teams).where(eq(teams.id, withTeam.id))
      expect(await db.select().from(challengeTeams).where(eq(challengeTeams.challengeId, challenge.id))).toHaveLength(1)

      await db.delete(challenges).where(eq(challenges.id, challenge.id))
      expect(await db.select().from(challengeTeams).where(eq(challengeTeams.teamId, withChallenge.id))).toHaveLength(0)
    } finally {
      await f.cleanup()
    }
  })

  it('o mesmo par desafio e equipe não se repete', async () => {
    const f = await makeTenant(0)
    try {
      const challenge = await newChallenge(f)
      const other = await addTeam(f)
      const link = () => db.insert(challengeTeams).values({ challengeId: challenge.id, teamId: other.id, tenantId: f.tenant.id })
      await link()

      await expect(link()).rejects.toMatchObject({ cause: { code: '23505' } })
    } finally {
      await f.cleanup()
    }
  })
})
