import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { teamMembers, teams, tenants, users } from '#/db/schema'
import { addTeam, addUser, makeTenant } from './test-fixtures'

const FOREIGN_KEY_VIOLATION = '23503'
const STATEMENT_BREAKPOINT = '--> statement-breakpoint'

function backfillStatement() {
  const dir = join(process.cwd(), 'drizzle')
  const file = readdirSync(dir).find((name) => name.startsWith('0010_'))!
  const statement = readFileSync(join(dir, file), 'utf8')
    .split(STATEMENT_BREAKPOINT)
    .find((s) => s.includes('INSERT INTO "team_members"'))
  if (!statement) throw new Error('A migração 0010 não tem o INSERT do backfill')
  return statement
}

afterAll(() => db.$client.end())

const linksOf = async (userIds: ReadonlyArray<string>) => {
  const rows = await db.select().from(teamMembers)
  return rows.filter((r) => userIds.includes(r.userId))
}

describe('backfill de team_members (SQL da própria migração)', () => {
  let f: Awaited<ReturnType<typeof makeTenant>>
  const rawUser = (id: string, role: (typeof users.$inferInsert)['role'], teamId: string | null, banned = false) =>
    db.insert(users).values({ id: `${id}-${f.tenant.slug}`, name: id, email: `${id}-${f.tenant.slug}@test.local`, role, teamId, tenantId: f.tenant.id, banned })

  beforeAll(async () => {
    f = await makeTenant(0)
    await rawUser('lider', 'TEAM_LEADER', f.team.id)
    await rawUser('membro', 'MEMBER', f.team.id)
    await rawUser('admin', 'TENANT_ADMIN', f.team.id)
    await rawUser('lider-sem-equipe', 'TEAM_LEADER', null)
    await rawUser('super', 'SUPER_ADMIN', f.team.id)
    await rawUser('banido', 'MEMBER', f.team.id, true)
  })
  afterAll(() => f.cleanup())

  const ids = () => ['lider', 'membro', 'admin', 'lider-sem-equipe', 'super', 'banido'].map((id) => `${id}-${f.tenant.slug}`)
  const roleByUser = async () => Object.fromEntries((await linksOf(ids())).map((l) => [l.userId.replace(`-${f.tenant.slug}`, ''), l.role]))

  it('líder vira LEADER; membro, admin com equipe e banido viram MEMBER; líder sem equipe e SUPER_ADMIN ficam sem vínculo', async () => {
    await db.execute(sql.raw(backfillStatement()))

    expect(await roleByUser()).toEqual({ lider: 'LEADER', membro: 'MEMBER', admin: 'MEMBER', banido: 'MEMBER' })
    expect((await linksOf(ids())).every((l) => l.teamId === f.team.id && l.tenantId === f.tenant.id)).toBe(true)
  })

  it('rodar de novo não duplica nem muda papel já ajustado', async () => {
    await db.update(teamMembers).set({ role: 'LEADER' }).where(eq(teamMembers.userId, `membro-${f.tenant.slug}`))

    await db.execute(sql.raw(backfillStatement()))

    expect(await roleByUser()).toEqual({ lider: 'LEADER', membro: 'LEADER', admin: 'MEMBER', banido: 'MEMBER' })
  })
})

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
