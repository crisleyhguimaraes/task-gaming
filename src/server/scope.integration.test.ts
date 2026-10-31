import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { tasks, users } from '#/db/schema'
import type { AuthCtx } from './roles'
import { activeMembersOf, assertMember, inTeams, inTenantTeams, teamIdsOf } from './scope'
import { addAdmin, addTeam, addUser, makeTenant } from './test-fixtures'

let a: Awaited<ReturnType<typeof makeTenant>>
let other: Awaited<ReturnType<typeof makeTenant>>
let teamB: Awaited<ReturnType<typeof addTeam>>
let admin: AuthCtx
let leaderA: AuthCtx
let memberA: AuthCtx
let memberB: AuthCtx
let teamless: AuthCtx
let otherAdmin: AuthCtx

const LOCK_PROBE_MS = 150
const titles = ['em A', 'em B', 'de outro tenant'] as const

const seedTask = (tenantId: string, teamId: string, title: (typeof titles)[number]) =>
  db.insert(tasks).values({ tenantId, teamId, createdById: leaderA.userId, title, basePoints: 10, estimatedSeconds: 600 })

async function visibleTo(me: AuthCtx, only?: string) {
  const rows = await db
    .select({ title: tasks.title })
    .from(tasks)
    .where(inTenantTeams(tasks, me, { only }))
  return rows.map((r) => r.title).sort()
}

beforeAll(async () => {
  a = await makeTenant(1)
  other = await makeTenant(1)
  teamB = await addTeam(a, 'B')
  admin = await addAdmin(a)
  leaderA = a.leader
  memberA = a.members[0]!
  memberB = await addUser(a, { role: 'MEMBER', team: teamB })
  teamless = await addUser(a, { role: 'MEMBER', team: null })
  otherAdmin = await addAdmin(other)
  await seedTask(a.tenant.id, a.team.id, 'em A')
  await seedTask(a.tenant.id, teamB.id, 'em B')
  await seedTask(other.tenant.id, other.team.id, 'de outro tenant')
})
afterAll(async () => {
  await a.cleanup()
  await other.cleanup()
  await db.$client.end()
})

describe('teamIdsOf', () => {
  it('admin enxerga todas as equipes', () => {
    expect(teamIdsOf(admin)).toBe('all')
  })

  it('líder e membro enxergam a própria equipe', () => {
    expect(teamIdsOf(leaderA)).toEqual([a.team.id])
    expect(teamIdsOf(memberB)).toEqual([teamB.id])
  })

  it('quem não tem equipe não enxerga nenhuma', () => {
    expect(teamIdsOf(teamless)).toEqual([])
  })
})

describe('inTeams', () => {
  it('admin não ganha filtro de equipe', () => {
    expect(inTeams(tasks.teamId, admin)).toBeUndefined()
  })
})

describe('inTenantTeams: matriz de visibilidade', () => {
  it('admin vê todas as equipes do tenant e nada de outro tenant', async () => {
    expect(await visibleTo(admin)).toEqual(['em A', 'em B'])
  })

  it('admin de outro tenant não vê o tenant alheio', async () => {
    expect(await visibleTo(otherAdmin)).toEqual(['de outro tenant'])
  })

  it('líder e membro veem só a própria equipe', async () => {
    expect(await visibleTo(leaderA)).toEqual(['em A'])
    expect(await visibleTo(memberA)).toEqual(['em A'])
    expect(await visibleTo(memberB)).toEqual(['em B'])
  })

  it('usuário sem equipe não vê nada e a consulta não falha', async () => {
    expect(await visibleTo(teamless)).toEqual([])
  })
})

describe('inTenantTeams: only', () => {
  it('admin restringe a uma equipe do próprio tenant', async () => {
    expect(await visibleTo(admin, teamB.id)).toEqual(['em B'])
  })

  it('admin pedindo equipe de outro tenant não vê nada', async () => {
    expect(await visibleTo(admin, other.team.id)).toEqual([])
  })

  it('quem pede a própria equipe a recebe', async () => {
    expect(await visibleTo(leaderA, a.team.id)).toEqual(['em A'])
  })

  it('quem pede equipe alheia recebe vazio, não a própria equipe', async () => {
    expect(await visibleTo(leaderA, teamB.id)).toEqual([])
    expect(await visibleTo(teamless, a.team.id)).toEqual([])
  })
})

describe('activeMembersOf e assertMember', () => {
  const asMember = (me: AuthCtx, teamId: string) => db.transaction((tx) => assertMember(tx, { tenantId: me.tenantId, userId: me.userId, teamId }))

  it('aceita membro ativo da equipe', async () => {
    await expect(asMember(memberA, a.team.id)).resolves.toBeUndefined()
  })

  it('recusa quem é de outra equipe, de outro tenant ou não existe', async () => {
    await expect(asMember(memberB, a.team.id)).rejects.toThrow('Responsável não pertence à equipe')
    await expect(asMember(otherAdmin, a.team.id)).rejects.toThrow('Responsável não pertence à equipe')
    await expect(asMember({ ...memberA, userId: 'ninguem' }, a.team.id)).rejects.toThrow('Responsável não pertence à equipe')
  })

  it('recusa usuário desativado e o tira da lista de membros ativos', async () => {
    const banned = await addUser(a, { role: 'MEMBER', team: a.team })
    await db.update(users).set({ banned: true }).where(eq(users.id, banned.userId))

    await expect(asMember(banned, a.team.id)).rejects.toThrow('Responsável não pertence à equipe')
    const active = await db.select({ id: users.id }).from(users).where(activeMembersOf(a.tenant.id, [a.team.id]))
    expect(active.map((u) => u.id)).not.toContain(banned.userId)
    expect(active.map((u) => u.id)).toContain(memberA.userId)
  })

  it('segura a linha do usuário: desativar só acontece depois que a atribuição termina', async () => {
    const target = await addUser(a, { role: 'MEMBER', team: a.team })
    let banned = false
    let ban!: Promise<void>

    await db.transaction(async (tx) => {
      await assertMember(tx, { tenantId: a.tenant.id, userId: target.userId, teamId: a.team.id })
      ban = db.update(users).set({ banned: true }).where(eq(users.id, target.userId)).then(() => void (banned = true))
      await new Promise((resolve) => setTimeout(resolve, LOCK_PROBE_MS))
      expect(banned).toBe(false)
    })

    await ban
    expect(banned).toBe(true)
  })
})
