import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { roleCapabilities } from '#/db/schema'
import { loadAuthCtx } from './auth-context.core'
import { addMember, removeMember } from './team-members.core'
import { addTeam, addUser, ctxFor, makeTenant } from './test-fixtures'

let f: Awaited<ReturnType<typeof makeTenant>>
let other: Awaited<ReturnType<typeof makeTenant>>
let teamB: Awaited<ReturnType<typeof addTeam>>

beforeAll(async () => {
  f = await makeTenant(1)
  other = await makeTenant(0)
  teamB = await addTeam(f, 'B')
})
afterAll(async () => {
  await f.cleanup()
  await other.cleanup()
  await db.$client.end()
})

describe('loadAuthCtx', () => {
  it('traz identidade e flags da sessão', async () => {
    const ctx = await loadAuthCtx(
      { id: f.leader.userId, tenantId: f.tenant.id, role: 'MEMBER', name: 'Léo', mustChangePassword: true },
      { impersonatedBy: 'super-1' },
    )

    expect(ctx).toMatchObject({ userId: f.leader.userId, tenantId: f.tenant.id, role: 'MEMBER', name: 'Léo', impersonatedBy: 'super-1', mustChangePassword: true })
  })

  it('carrega os vínculos com o papel em cada equipe, na ordem em que a pessoa entrou', async () => {
    const person = await addUser(f, { role: 'MEMBER', team: f.team })
    await db.transaction((tx) => addMember(tx, person, { teamId: teamB.id, userId: person.userId, role: 'LEADER' }))

    const ctx = await ctxFor(person.userId)

    expect(ctx.memberships).toEqual([
      { teamId: f.team.id, role: 'MEMBER' },
      { teamId: teamB.id, role: 'LEADER' },
    ])
  })

  it('quem não tem vínculo carrega memberships vazio, e o contexto não tem mais o alias teamId', async () => {
    const teamless = await addUser(f, { role: 'MEMBER', team: null })

    const ctx = await ctxFor(teamless.userId)

    expect(ctx.memberships).toEqual([])
    expect(ctx).not.toHaveProperty('teamId')
    expect(await ctxFor(f.leader.userId)).toMatchObject({ memberships: [{ teamId: f.team.id, role: 'LEADER' }] })
  })

  it('o vínculo vale na hora: entrar e sair de uma equipe aparece no próximo carregamento', async () => {
    const person = await addUser(f, { role: 'MEMBER', team: null })

    await db.transaction((tx) => addMember(tx, person, { teamId: teamB.id, userId: person.userId }))
    expect((await ctxFor(person.userId)).memberships).toEqual([{ teamId: teamB.id, role: 'MEMBER' }])

    await db.transaction((tx) => removeMember(tx, person, { teamId: teamB.id, userId: person.userId }))
    expect((await ctxFor(person.userId)).memberships).toEqual([])
  })

  it('carrega os overrides do tenant agrupados por papel de equipe, sem vazar de outro tenant', async () => {
    await db.insert(roleCapabilities).values([
      { tenantId: f.tenant.id, role: 'LEADER', capability: 'user.create', allowed: false },
      { tenantId: f.tenant.id, role: 'MEMBER', capability: 'export.csv', allowed: true },
      { tenantId: other.tenant.id, role: 'MEMBER', capability: 'lead.import', allowed: true },
    ])

    const ctx = await ctxFor(f.members[0]!.userId)

    expect(ctx.capabilityOverrides).toEqual({ LEADER: { 'user.create': false }, MEMBER: { 'export.csv': true } })
  })

  it('tenant sem overrides carrega objeto vazio', async () => {
    const clean = await makeTenant(0)
    try {
      expect((await ctxFor(clean.leader.userId)).capabilityOverrides).toEqual({})
    } finally {
      await clean.cleanup()
    }
  })
})
