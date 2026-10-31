import { and, asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { auditEvents, teamMembers } from '#/db/schema'
import type { AuthCtx } from './roles'
import { addMember, removeMember, setRole } from './team-members.core'
import { addAdmin, addTeam, addUser, makeTenant } from './test-fixtures'

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

const add = (teamId: string, userId: string, role?: 'LEADER' | 'MEMBER') => db.transaction((tx) => addMember(tx, admin, { teamId, userId, role }))
const remove = (teamId: string, userId: string) => db.transaction((tx) => removeMember(tx, admin, { teamId, userId }))
const change = (teamId: string, userId: string, role: 'LEADER' | 'MEMBER') => db.transaction((tx) => setRole(tx, admin, { teamId, userId, role }))

const linksOf = (teamId: string, userId: string) =>
  db.select().from(teamMembers).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))

const eventsOf = (teamId: string) =>
  db.select().from(auditEvents).where(and(eq(auditEvents.tenantId, f.tenant.id), eq(auditEvents.entityType, 'team'), eq(auditEvents.entityId, teamId))).orderBy(asc(auditEvents.createdAt), asc(auditEvents.id))

const freshTeamAndUser = async (role: AuthCtx['role'] = 'MEMBER') => ({ team: await addTeam(f, 'Nova'), user: await addUser(f, { role, team: null }) })

describe('addMember', () => {
  it('cria o vínculo com o papel pedido (MEMBER por padrão) e audita na equipe', async () => {
    const { team, user } = await freshTeamAndUser()
    const candidate = await addUser(f, { role: 'MEMBER', team: null })

    await add(team.id, user.userId)
    await add(team.id, candidate.userId, 'LEADER')

    expect(await linksOf(team.id, user.userId)).toMatchObject([{ role: 'MEMBER', tenantId: f.tenant.id }])
    expect(await linksOf(team.id, candidate.userId)).toMatchObject([{ role: 'LEADER' }])
    expect(await eventsOf(team.id)).toMatchObject([
      { action: 'team.member_added', actorId: admin.userId, entityType: 'team', meta: { userId: user.userId, role: 'MEMBER' } },
      { action: 'team.member_added', meta: { userId: candidate.userId, role: 'LEADER' } },
    ])
  })

  it('repetir com o mesmo papel não duplica nem audita de novo', async () => {
    const { team, user } = await freshTeamAndUser()

    await add(team.id, user.userId)
    await add(team.id, user.userId)

    expect(await linksOf(team.id, user.userId)).toHaveLength(1)
    expect(await eventsOf(team.id)).toHaveLength(1)
  })

  it('quem já é membro com outro papel só muda de papel, e isso é auditado como troca', async () => {
    const { team, user } = await freshTeamAndUser()
    await add(team.id, user.userId, 'MEMBER')

    await add(team.id, user.userId, 'LEADER')

    expect(await linksOf(team.id, user.userId)).toMatchObject([{ role: 'LEADER' }])
    expect((await eventsOf(team.id)).map((e) => e.action)).toEqual(['team.member_added', 'team.member_role_changed'])
  })

  it('dois cadastros simultâneos do mesmo par resultam em um vínculo e uma auditoria', async () => {
    const { team, user } = await freshTeamAndUser()

    await Promise.all([add(team.id, user.userId), add(team.id, user.userId)])

    expect(await linksOf(team.id, user.userId)).toHaveLength(1)
    expect(await eventsOf(team.id)).toHaveLength(1)
  })

  it('recusa equipe de outro tenant, usuário de outro tenant e SUPER_ADMIN, sem gravar nada', async () => {
    const { team, user } = await freshTeamAndUser()
    const foreignUser = await addUser(other, { role: 'MEMBER', team: null })
    const root = await addUser(f, { role: 'SUPER_ADMIN', team: null })

    await expect(add(other.team.id, user.userId)).rejects.toThrow('Equipe não encontrada')
    await expect(add(team.id, foreignUser.userId)).rejects.toThrow('Usuário não encontrado')
    await expect(add(team.id, root.userId)).rejects.toThrow('Usuário não encontrado')

    expect(await linksOf(other.team.id, user.userId)).toHaveLength(0)
    expect(await linksOf(team.id, foreignUser.userId)).toHaveLength(0)
    expect(await linksOf(team.id, root.userId)).toHaveLength(0)
    expect(await eventsOf(team.id)).toHaveLength(0)
  })

  it('a falha desfaz a auditoria junto: sem transação concluída, nada fica', async () => {
    const { team, user } = await freshTeamAndUser()

    await expect(
      db.transaction(async (tx) => {
        await addMember(tx, admin, { teamId: team.id, userId: user.userId })
        throw new Error('falha depois do vínculo')
      }),
    ).rejects.toThrow('falha depois do vínculo')

    expect(await linksOf(team.id, user.userId)).toHaveLength(0)
    expect(await eventsOf(team.id)).toHaveLength(0)
  })
})

describe('removeMember', () => {
  it('apaga o vínculo e audita com o papel que a pessoa tinha', async () => {
    const { team, user } = await freshTeamAndUser()
    await add(team.id, user.userId, 'LEADER')

    await remove(team.id, user.userId)

    expect(await linksOf(team.id, user.userId)).toHaveLength(0)
    expect((await eventsOf(team.id)).at(-1)).toMatchObject({ action: 'team.member_removed', meta: { userId: user.userId, role: 'LEADER' } })
  })

  it('remover quem não é membro não faz nada nem audita', async () => {
    const { team, user } = await freshTeamAndUser()

    await remove(team.id, user.userId)

    expect(await eventsOf(team.id)).toHaveLength(0)
  })

  it('recusa equipe e usuário de outro tenant e SUPER_ADMIN', async () => {
    const { team } = await freshTeamAndUser()
    const foreignUser = await addUser(other, { role: 'MEMBER', team: other.team })
    const root = await addUser(f, { role: 'SUPER_ADMIN', team: null })

    await expect(remove(other.team.id, foreignUser.userId)).rejects.toThrow('Equipe não encontrada')
    await expect(remove(team.id, foreignUser.userId)).rejects.toThrow('Usuário não encontrado')
    await expect(remove(team.id, root.userId)).rejects.toThrow('Usuário não encontrado')

    expect(await linksOf(other.team.id, foreignUser.userId)).toHaveLength(1)
  })
})

describe('setRole', () => {
  it('troca o papel e audita com o antes e o depois', async () => {
    const { team, user } = await freshTeamAndUser()
    await add(team.id, user.userId, 'MEMBER')

    await change(team.id, user.userId, 'LEADER')

    expect(await linksOf(team.id, user.userId)).toMatchObject([{ role: 'LEADER' }])
    expect((await eventsOf(team.id)).at(-1)).toMatchObject({
      action: 'team.member_role_changed',
      meta: { userId: user.userId, role: 'LEADER' },
      changes: { role: { from: 'MEMBER', to: 'LEADER' } },
    })
  })

  it('o mesmo papel não faz nada nem audita', async () => {
    const { team, user } = await freshTeamAndUser()
    await add(team.id, user.userId, 'LEADER')

    await change(team.id, user.userId, 'LEADER')

    expect(await eventsOf(team.id)).toHaveLength(1)
  })

  it('recusa quem não é membro, equipe de outro tenant e SUPER_ADMIN', async () => {
    const { team, user } = await freshTeamAndUser()
    const root = await addUser(f, { role: 'SUPER_ADMIN', team: null })

    await expect(change(team.id, user.userId, 'LEADER')).rejects.toThrow('não é membro')
    await expect(change(other.team.id, user.userId, 'LEADER')).rejects.toThrow('Equipe não encontrada')
    await expect(change(team.id, root.userId, 'LEADER')).rejects.toThrow('Usuário não encontrado')
  })
})
