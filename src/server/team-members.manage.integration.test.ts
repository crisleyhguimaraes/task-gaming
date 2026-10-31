import { and, asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { auditEvents, teamMembers } from '#/db/schema'
import type { TeamRole } from '#/lib/access'
import type { AuthCtx } from './roles'
import { ForbiddenError } from './roles'
import { addTeamMemberFor, removeTeamMemberFor, setTeamMemberRoleFor } from './team-members.core'
import { addAdmin, addTeam, addUser, ctxFor, joinTeam, makeTenant } from './test-fixtures'

let f: Awaited<ReturnType<typeof makeTenant>>
let other: Awaited<ReturnType<typeof makeTenant>>
let admin: AuthCtx

beforeAll(async () => {
  f = await makeTenant(0)
  other = await makeTenant(0)
  admin = await addAdmin(f)
})
afterAll(async () => {
  await f.cleanup()
  await other.cleanup()
  await db.$client.end()
})

const delegated: AuthCtx['capabilityOverrides'] = { LEADER: { 'team.member.manage': true } }
const withOverrides = (me: AuthCtx, capabilityOverrides: AuthCtx['capabilityOverrides']): AuthCtx => ({ ...me, capabilityOverrides })

const roleOf = async (teamId: string, userId: string) =>
  (await db.select({ role: teamMembers.role }).from(teamMembers).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId))))[0]?.role ?? null

const eventsOf = (teamId: string) =>
  db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.tenantId, f.tenant.id), eq(auditEvents.entityType, 'team'), eq(auditEvents.entityId, teamId)))
    .orderBy(asc(auditEvents.createdAt), asc(auditEvents.id))

async function scenario() {
  const team = await addTeam(f, 'Equipe do cenário')
  const leader = await addUser(f, { role: 'MEMBER', team, teamRole: 'LEADER' })
  const member = await addUser(f, { role: 'MEMBER', team })
  const person = await addUser(f, { role: 'MEMBER', team: null })
  return { team, leader, member, person }
}

const add = (me: AuthCtx, teamId: string, userId: string, role: TeamRole = 'MEMBER') => addTeamMemberFor(me, { teamId, userId, role })
const remove = (me: AuthCtx, teamId: string, userId: string) => removeTeamMemberFor(me, { teamId, userId })
const change = (me: AuthCtx, teamId: string, userId: string, role: TeamRole) => setTeamMemberRoleFor(me, { teamId, userId, role })

describe('addTeamMemberFor', () => {
  it('admin põe uma pessoa que já existe numa segunda equipe, e ela passa a ter as duas', async () => {
    const { team, person } = await scenario()
    const first = await addTeam(f, 'Primeira')
    await add(admin, first.id, person.userId)

    await add(admin, team.id, person.userId)

    expect((await ctxFor(person.userId)).memberships.map((m) => m.teamId).sort()).toEqual([first.id, team.id].sort())
    expect(await eventsOf(team.id)).toMatchObject([{ action: 'team.member_added', actorId: admin.userId, meta: { userId: person.userId, role: 'MEMBER' } }])
  })

  it('admin pode já promover a líder; a pessoa vira líder só nessa equipe', async () => {
    const { team, person } = await scenario()
    const first = await addTeam(f, 'Primeira')
    await add(admin, first.id, person.userId)

    await add(admin, team.id, person.userId, 'LEADER')

    expect(await roleOf(team.id, person.userId)).toBe('LEADER')
    expect(await roleOf(first.id, person.userId)).toBe('MEMBER')
  })

  it('por padrão líder e membro não adicionam ninguém', async () => {
    const { team, leader, member, person } = await scenario()

    await expect(add(leader, team.id, person.userId)).rejects.toThrow(ForbiddenError)
    await expect(add(member, team.id, person.userId)).rejects.toThrow(ForbiddenError)

    expect(await roleOf(team.id, person.userId)).toBeNull()
  })

  it('líder com a capability delegada adiciona membro à equipe que lidera, mas não líder', async () => {
    const { team, leader, person } = await scenario()
    const other2 = await addUser(f, { role: 'MEMBER', team: null })
    const delegate = withOverrides(leader, delegated)

    await add(delegate, team.id, person.userId)
    await expect(add(delegate, team.id, other2.userId, 'LEADER')).rejects.toThrow(ForbiddenError)

    expect(await roleOf(team.id, person.userId)).toBe('MEMBER')
    expect(await roleOf(team.id, other2.userId)).toBeNull()
    expect(await eventsOf(team.id)).toMatchObject([{ actorId: leader.userId, meta: { userId: person.userId } }])
  })

  it('a delegação vale na equipe que o líder lidera e não naquela onde ele só é membro, nem em equipe alheia', async () => {
    const { team: led, leader, person } = await scenario()
    const joined = await addTeam(f, 'Onde é membro')
    const stranger = await addTeam(f, 'Que não integra')
    const delegate = withOverrides(await joinTeam(f, leader.userId, joined), delegated)

    await add(delegate, led.id, person.userId)
    await expect(add(delegate, joined.id, person.userId)).rejects.toThrow(ForbiddenError)
    await expect(add(delegate, stranger.id, person.userId)).rejects.toThrow(ForbiddenError)

    expect(await roleOf(joined.id, person.userId)).toBeNull()
    expect(await roleOf(stranger.id, person.userId)).toBeNull()
  })

  it('repetir o mesmo vínculo não duplica nem audita de novo', async () => {
    const { team, person } = await scenario()

    await add(admin, team.id, person.userId)
    await add(admin, team.id, person.userId)

    expect(await eventsOf(team.id)).toHaveLength(1)
  })

  it('quem já está na equipe com outro papel não muda de papel por aqui, nem por líder delegado', async () => {
    const { team, leader, member } = await scenario()
    const delegate = withOverrides(leader, delegated)

    await expect(add(admin, team.id, member.userId, 'LEADER')).rejects.toThrow('outro papel')
    await expect(add(delegate, team.id, leader.userId)).rejects.toThrow('outro papel')

    expect(await roleOf(team.id, member.userId)).toBe('MEMBER')
    expect(await roleOf(team.id, leader.userId)).toBe('LEADER')
  })

  it('recusa equipe e pessoa de outro tenant e SUPER_ADMIN, sem gravar nada', async () => {
    const { team, person } = await scenario()
    const foreign = await addUser(other, { role: 'MEMBER', team: null })
    const root = await addUser(f, { role: 'SUPER_ADMIN', team: null })

    await expect(add(admin, other.team.id, person.userId)).rejects.toThrow('Equipe não encontrada')
    await expect(add(admin, team.id, foreign.userId)).rejects.toThrow('Usuário não encontrado')
    await expect(add(admin, team.id, root.userId)).rejects.toThrow('Usuário não encontrado')

    expect(await eventsOf(team.id)).toHaveLength(0)
  })

  it('dois administradores somando a mesma pessoa resultam em um vínculo e um evento', async () => {
    const { team, person } = await scenario()

    await Promise.all([add(admin, team.id, person.userId), add(admin, team.id, person.userId)])

    expect(await eventsOf(team.id)).toHaveLength(1)
  })

  it('admin promovendo e líder delegado adicionando a mesma pessoa ao mesmo tempo: um vence e o papel é o dele', async () => {
    const { team, leader, person } = await scenario()

    const results = await Promise.allSettled([add(admin, team.id, person.userId, 'LEADER'), add(withOverrides(leader, delegated), team.id, person.userId)])

    const winner = results.findIndex((r) => r.status === 'fulfilled')
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(await roleOf(team.id, person.userId)).toBe(winner === 0 ? 'LEADER' : 'MEMBER')
    expect(await eventsOf(team.id)).toHaveLength(1)
  })
})

describe('removeTeamMemberFor', () => {
  it('admin tira a pessoa de uma equipe e ela continua na outra', async () => {
    const { team, person } = await scenario()
    const stays = await addTeam(f, 'Fica')
    await add(admin, team.id, person.userId)
    await add(admin, stays.id, person.userId)

    await remove(admin, team.id, person.userId)

    expect(await roleOf(team.id, person.userId)).toBeNull()
    expect(await roleOf(stays.id, person.userId)).toBe('MEMBER')
    expect((await eventsOf(team.id)).at(-1)).toMatchObject({ action: 'team.member_removed', meta: { userId: person.userId, role: 'MEMBER' } })
  })

  it('o líder tira membro da própria equipe, sem precisar de delegação', async () => {
    const { team, leader, member } = await scenario()

    await remove(leader, team.id, member.userId)

    expect(await roleOf(team.id, member.userId)).toBeNull()
    expect((await eventsOf(team.id)).at(-1)).toMatchObject({ action: 'team.member_removed', actorId: leader.userId })
  })

  it('o líder não tira outro líder nem a si mesmo; só o admin', async () => {
    const { team, leader } = await scenario()
    const coLeader = await addUser(f, { role: 'MEMBER', team, teamRole: 'LEADER' })

    await expect(remove(leader, team.id, coLeader.userId)).rejects.toThrow(ForbiddenError)
    await expect(remove(leader, team.id, leader.userId)).rejects.toThrow(ForbiddenError)
    expect(await roleOf(team.id, coLeader.userId)).toBe('LEADER')

    await remove(admin, team.id, coLeader.userId)
    expect(await roleOf(team.id, coLeader.userId)).toBeNull()
  })

  it('o líder não age na equipe onde só é membro, nem na que não integra', async () => {
    const { team, leader, member } = await scenario()
    const joined = await addTeam(f, 'Onde é membro')
    const stranger = await addTeam(f, 'Que não integra')
    const target = await addUser(f, { role: 'MEMBER', team: joined })
    await add(admin, stranger.id, target.userId)
    const twoTeams = await joinTeam(f, leader.userId, joined)

    await expect(remove(twoTeams, joined.id, target.userId)).rejects.toThrow(ForbiddenError)
    await expect(remove(twoTeams, stranger.id, target.userId)).rejects.toThrow(ForbiddenError)
    await expect(remove(member, team.id, leader.userId)).rejects.toThrow(ForbiddenError)

    expect(await roleOf(joined.id, target.userId)).toBe('MEMBER')
    expect(await roleOf(stranger.id, target.userId)).toBe('MEMBER')
  })

  it('remover quem não é membro não faz nada nem audita', async () => {
    const { team, leader, person } = await scenario()

    await remove(admin, team.id, person.userId)
    await remove(leader, team.id, person.userId)

    expect(await eventsOf(team.id)).toHaveLength(0)
  })

  it('recusa equipe e pessoa de outro tenant e SUPER_ADMIN', async () => {
    const { team } = await scenario()
    const foreign = await addUser(other, { role: 'MEMBER', team: other.team })
    const root = await addUser(f, { role: 'SUPER_ADMIN', team: null })

    await expect(remove(admin, other.team.id, foreign.userId)).rejects.toThrow('Equipe não encontrada')
    await expect(remove(admin, team.id, foreign.userId)).rejects.toThrow('Usuário não encontrado')
    await expect(remove(admin, team.id, root.userId)).rejects.toThrow('Usuário não encontrado')

    expect(await roleOf(other.team.id, foreign.userId)).toBe('MEMBER')
  })

  it('líder tirando e admin promovendo a mesma pessoa ao mesmo tempo: ou sai membro, ou o líder é recusado e ela fica líder', async () => {
    const { team, leader, member } = await scenario()

    const [removal] = await Promise.allSettled([remove(leader, team.id, member.userId), change(admin, team.id, member.userId, 'LEADER')])

    if (removal.status === 'fulfilled') return expect(await roleOf(team.id, member.userId)).toBeNull()
    expect(removal.reason).toBeInstanceOf(ForbiddenError)
    expect(await roleOf(team.id, member.userId)).toBe('LEADER')
  })
})

describe('setTeamMemberRoleFor', () => {
  it('admin promove e rebaixa, e a troca é auditada com o antes e o depois', async () => {
    const { team, member } = await scenario()

    await change(admin, team.id, member.userId, 'LEADER')
    expect(await roleOf(team.id, member.userId)).toBe('LEADER')
    await change(admin, team.id, member.userId, 'MEMBER')

    expect(await roleOf(team.id, member.userId)).toBe('MEMBER')
    expect((await eventsOf(team.id)).at(-1)).toMatchObject({ action: 'team.member_role_changed', actorId: admin.userId, changes: { role: { from: 'LEADER', to: 'MEMBER' } } })
  })

  it('o papel só muda na equipe pedida', async () => {
    const { team, member } = await scenario()
    const second = await addTeam(f, 'Segunda')
    await add(admin, second.id, member.userId)

    await change(admin, team.id, member.userId, 'LEADER')

    expect(await roleOf(second.id, member.userId)).toBe('MEMBER')
  })

  it('líder não promove ninguém, nem com a capability delegada; membro também não', async () => {
    const { team, leader, member } = await scenario()

    await expect(change(leader, team.id, member.userId, 'LEADER')).rejects.toThrow(ForbiddenError)
    await expect(change(withOverrides(leader, delegated), team.id, member.userId, 'LEADER')).rejects.toThrow(ForbiddenError)
    await expect(change(member, team.id, member.userId, 'LEADER')).rejects.toThrow(ForbiddenError)

    expect(await roleOf(team.id, member.userId)).toBe('MEMBER')
  })

  it('o mesmo papel não faz nada nem audita', async () => {
    const { team, member } = await scenario()

    await change(admin, team.id, member.userId, 'MEMBER')

    expect(await eventsOf(team.id)).toHaveLength(0)
  })

  it('uma equipe pode ficar sem líder: rebaixar o único líder é permitido', async () => {
    const { team, leader } = await scenario()

    await change(admin, team.id, leader.userId, 'MEMBER')

    expect(await roleOf(team.id, leader.userId)).toBe('MEMBER')
  })

  it('recusa quem não é membro, equipe de outro tenant e SUPER_ADMIN', async () => {
    const { team, person } = await scenario()
    const root = await addUser(f, { role: 'SUPER_ADMIN', team: null })

    await expect(change(admin, team.id, person.userId, 'LEADER')).rejects.toThrow('não é membro')
    await expect(change(admin, other.team.id, person.userId, 'LEADER')).rejects.toThrow('Equipe não encontrada')
    await expect(change(admin, team.id, root.userId, 'LEADER')).rejects.toThrow('Usuário não encontrado')
  })
})
