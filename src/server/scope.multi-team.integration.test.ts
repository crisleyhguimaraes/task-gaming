import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { tasks, users } from '#/db/schema'
import type { AuthCtx } from './roles'
import { createInvitationCore } from './invitations.core'
import { ForbiddenError, canManage, canSee, isAdmin, managedTeamIds } from './roles'
import { activeMembersOf, assertMember, assertWithinScope, inTenantTeams, teamIdsOf, usersInScope } from './scope'
import { createTaskFor } from './tasks.core'
import { addAdmin, addTeam, addUser, joinTeam, makeTenant } from './test-fixtures'
import { listUsersFor } from './users.core'

type Fixture = Awaited<ReturnType<typeof makeTenant>>
type Team = Awaited<ReturnType<typeof addTeam>>

let f: Fixture
let outsiders: Fixture
let teamA: Team
let teamB: Team
let teamC: Team
let profiles: Record<string, AuthCtx>

const seedTask = (team: Team) =>
  db.insert(tasks).values({ tenantId: f.tenant.id, teamId: team.id, createdById: f.leader.userId, title: team.id, basePoints: 10, estimatedSeconds: 600 })

const visibleTeams = async (me: AuthCtx) => {
  const rows = await db.select({ teamId: tasks.teamId }).from(tasks).where(inTenantTeams(tasks, me))
  return rows.map((r) => r.teamId).sort()
}

beforeAll(async () => {
  f = await makeTenant(1)
  outsiders = await makeTenant(1)
  teamA = f.team
  teamB = await addTeam(f, 'B')
  teamC = await addTeam(f, 'C')
  await Promise.all([teamA, teamB, teamC].map(seedTask))
  const leaderAMemberB = await joinTeam(f, (await addUser(f, { role: 'TEAM_LEADER', team: teamA })).userId, teamB, 'MEMBER')
  profiles = {
    admin: await addAdmin(f),
    'líder em A e membro em B': leaderAMemberB,
    'membro em A': f.members[0]!,
    'sem equipe': await addUser(f, { role: 'MEMBER', team: null }),
    'membro de outro tenant': outsiders.members[0]!,
  }
})
afterAll(async () => {
  await f.cleanup()
  await outsiders.cleanup()
  await db.$client.end()
})

describe('paridade entre os predicados puros e as consultas SQL', () => {
  it.each(['admin', 'líder em A e membro em B', 'membro em A', 'sem equipe', 'membro de outro tenant'])('%s: a consulta e canSee/canManage concordam em cada equipe', async (name) => {
    const me = profiles[name]!
    const visible = await visibleTeams(me)

    for (const team of [teamA, teamB, teamC]) {
      const record = { teamId: team.id, assignedToId: null }
      const sameTenant = me.tenantId === f.tenant.id
      expect(visible.includes(team.id), `${name} vê ${team.id}`).toBe(sameTenant && canSee(me, record))
      expect(canManage(me, record), `${name} gerencia ${team.id}`).toBe(isAdmin(me) || managedTeamIds(me).includes(team.id))
      if (sameTenant && canManage(me, record)) expect(visible).toContain(team.id)
    }
  })

  it('o perfil que lidera A e integra B vê A e B, e gerencia só A', async () => {
    const me = profiles['líder em A e membro em B']!

    expect(await visibleTeams(me)).toEqual([teamA.id, teamB.id].sort())
    expect(canManage(me, { teamId: teamA.id })).toBe(true)
    expect(canManage(me, { teamId: teamB.id })).toBe(false)
    expect(canManage(me, { teamId: teamC.id })).toBe(false)
  })
})

describe('teamIdsOf sobre vínculos', () => {
  const twoTeams = () => profiles['líder em A e membro em B']!

  it('lista todos os vínculos, e com capability só as equipes onde ela vale', () => {
    expect([...(teamIdsOf(twoTeams()) as Array<string>)].sort()).toEqual([teamA.id, teamB.id].sort())
    expect(teamIdsOf(twoTeams(), 'user.create')).toEqual([teamA.id])
    expect(teamIdsOf(twoTeams(), 'lead.write')).toHaveLength(2)
  })

  it('admin vê o tenant todo, desde que tenha a capability', () => {
    expect(teamIdsOf(profiles.admin!)).toBe('all')
    expect(teamIdsOf(profiles.admin!, 'user.read')).toBe('all')
    expect(teamIdsOf(profiles.admin!, 'tenant.manage')).toEqual([])
  })

  it('quem não tem vínculo não enxerga equipe nenhuma', () => {
    expect(teamIdsOf(profiles['sem equipe']!)).toEqual([])
  })
})

describe('assertWithinScope com várias equipes', () => {
  it('líder age sobre membro da equipe que lidera e não sobre a que só integra', () => {
    const me = profiles['líder em A e membro em B']!

    expect(() => assertWithinScope(me, { role: 'MEMBER', teamId: teamA.id }, 'user.create')).not.toThrow()
    expect(() => assertWithinScope(me, { role: 'MEMBER', teamId: teamB.id }, 'user.create')).toThrow('Sem permissão')
    expect(() => assertWithinScope(me, { role: 'MEMBER', teamId: null }, 'user.create')).toThrow('Sem permissão')
  })

  it('membro comum só age onde a capability foi delegada ao papel dele', () => {
    const delegated = { ...profiles['membro em A']!, capabilityOverrides: { MEMBER: { 'user.create': true } } }

    expect(() => assertWithinScope(delegated, { role: 'MEMBER', teamId: teamA.id }, 'user.create')).not.toThrow()
    expect(() => assertWithinScope(delegated, { role: 'MEMBER', teamId: teamA.id }, 'user.update')).toThrow('Sem permissão')
  })

  it('ninguém que não seja admin age sobre líder ou administrador', () => {
    expect(() => assertWithinScope(profiles['líder em A e membro em B']!, { role: 'TEAM_LEADER', teamId: teamA.id }, 'user.create')).toThrow('Sem permissão')
  })

  it('membro comum não age sobre ninguém', () => {
    expect(() => assertWithinScope(profiles['membro em A']!, { role: 'MEMBER', teamId: teamA.id }, 'user.create')).toThrow('Sem permissão')
  })
})

describe('membros ativos lidos de team_members', () => {
  const twoTeamsUserId = () => profiles['líder em A e membro em B']!.userId
  const asMember = (userId: string, teamId: string) => db.transaction((tx) => assertMember(tx, { tenantId: f.tenant.id, userId, teamId }))
  const activeIn = async (teamIds: Array<string>) => (await db.select({ id: users.id }).from(users).where(activeMembersOf(f.tenant.id, teamIds))).map((u) => u.id)

  it('quem está em duas equipes é responsável válido nas duas', async () => {
    await expect(asMember(twoTeamsUserId(), teamA.id)).resolves.toBeUndefined()
    await expect(asMember(twoTeamsUserId(), teamB.id)).resolves.toBeUndefined()
    await expect(asMember(twoTeamsUserId(), teamC.id)).rejects.toThrow('Responsável não pertence à equipe')
    expect(await activeIn([teamB.id])).toContain(twoTeamsUserId())
  })

  it('o vínculo em team_members é a fonte: users.team_id sozinho não faz ninguém membro', async () => {
    const legacyOnly = await addUser(f, { role: 'MEMBER', team: null })
    await db.update(users).set({ teamId: teamC.id }).where(eq(users.id, legacyOnly.userId))

    await expect(asMember(legacyOnly.userId, teamC.id)).rejects.toThrow('Responsável não pertence à equipe')
    expect(await activeIn([teamC.id])).not.toContain(legacyOnly.userId)
  })

  it('desativado deixa de ser responsável mesmo com vínculo', async () => {
    const banned = await joinTeam(f, (await addUser(f, { role: 'MEMBER', team: teamA })).userId, teamC)
    await db.update(users).set({ banned: true }).where(eq(users.id, banned.userId))

    await expect(asMember(banned.userId, teamC.id)).rejects.toThrow('Responsável não pertence à equipe')
    expect(await activeIn([teamC.id])).not.toContain(banned.userId)
  })

  it('lista de equipes vazia não tem membros e a consulta não falha', async () => {
    expect(await activeIn([])).toEqual([])
  })
})

describe('usersInScope', () => {
  const idsIn = async (me: AuthCtx, options?: Parameters<typeof usersInScope>[1]) =>
    (await db.select({ id: users.id }).from(users).where(usersInScope(me, options))).map((u) => u.id)

  it('admin lista todo o tenant, inclusive quem não tem equipe, e nada de outro tenant', async () => {
    const ids = await idsIn(profiles.admin!)

    expect(ids).toContain(profiles['sem equipe']!.userId)
    expect(ids).not.toContain(profiles['membro de outro tenant']!.userId)
  })

  it('quem tem várias equipes lista os colegas de todas, e com capability só das equipes onde ela vale', async () => {
    const me = profiles['líder em A e membro em B']!
    const inB = await joinTeam(f, (await addUser(f, { role: 'MEMBER', team: null })).userId, teamB)

    expect(await idsIn(me)).toEqual(expect.arrayContaining([f.members[0]!.userId, inB.userId]))
    expect(await idsIn(me, { capability: 'user.create' })).toContain(f.members[0]!.userId)
    expect(await idsIn(me, { capability: 'user.create' })).not.toContain(inB.userId)
  })

  it('only restringe a uma equipe, e equipe alheia dá vazio', async () => {
    const me = profiles['líder em A e membro em B']!

    expect(await idsIn(me, { only: teamB.id })).not.toContain(f.members[0]!.userId)
    expect(await idsIn(me, { only: teamC.id })).toEqual([])
  })

  it('quem não tem equipe não lista ninguém', async () => {
    expect(await idsIn(profiles['sem equipe']!)).toEqual([])
  })
})

describe('pessoa que lidera A e integra B, pelas funções de negócio', () => {
  const task = (teamId: string) => ({ title: 'T', basePoints: 10, estimatedMinutes: 5, teamId, assignedToId: null })
  const me = () => profiles['líder em A e membro em B']!

  it('cria tarefa só na equipe que lidera', async () => {
    await expect(createTaskFor(me(), task(teamA.id))).resolves.toMatchObject({ teamId: teamA.id })
    await expect(createTaskFor(me(), task(teamB.id))).rejects.toThrow(ForbiddenError)
  })

  it('convida só para a equipe que lidera', async () => {
    await expect(createInvitationCore(me(), { email: `a-${f.tenant.slug}@test.local`, teamId: teamA.id, role: 'MEMBER' })).resolves.toBeDefined()
    await expect(createInvitationCore(me(), { email: `b-${f.tenant.slug}@test.local`, teamId: teamB.id, role: 'MEMBER' })).rejects.toThrow(ForbiddenError)
  })

  it('lista usuários só das equipes onde pode ler usuários', async () => {
    const inB = await joinTeam(f, (await addUser(f, { role: 'MEMBER', team: null })).userId, teamB)

    const ids = (await listUsersFor(me())).users.map((u) => u.id)

    expect(ids).toContain(f.members[0]!.userId)
    expect(ids).not.toContain(inB.userId)
  })
})
