import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { challenges, leads, pipelineStages, tenants } from '#/db/schema'
import type { AuthCtx } from './roles'
import { createTeamFor, deleteTeamFor, listTeamsFor } from './teams.core'
import { addAdmin, addUser, joinTeam, makeTenant } from './test-fixtures'
import { createTenantFor, tenantMembersOf } from './tenants.core'

let f: Awaited<ReturnType<typeof makeTenant>>
let admin: AuthCtx
const createdTenants: Array<string> = []

beforeAll(async () => {
  f = await makeTenant(0)
  admin = await addAdmin(f)
})
afterAll(async () => {
  if (createdTenants.length) await db.delete(tenants).where(inArray(tenants.id, createdTenants))
  await f.cleanup()
  await db.$client.end()
})

describe('funil padrão', () => {
  it('tenant novo nasce com etapas abertas, uma ganha e uma perdida, em ordem', async () => {
    const tenant = await createTenantFor({ ...admin, role: 'SUPER_ADMIN' }, { name: 'Com funil', slug: `funil-${f.tenant.slug}`, timezone: 'America/Sao_Paulo' })
    createdTenants.push(tenant.id)

    const stages = await db.select().from(pipelineStages).where(eq(pipelineStages.tenantId, tenant.id)).orderBy(pipelineStages.sortOrder)

    expect(stages.map((s) => s.kind)).toEqual(['open', 'open', 'open', 'open', 'won', 'lost'])
    expect(stages.find((s) => s.kind === 'won')!.probability).toBe(100)
    expect(stages.find((s) => s.kind === 'lost')!.probability).toBe(0)
  })

  it('tenant criado pelo fixture também tem funil', async () => {
    expect(await db.select().from(pipelineStages).where(eq(pipelineStages.tenantId, f.tenant.id))).toHaveLength(6)
  })
})

describe('excluir equipe', () => {
  it('recusa equipe com leads', async () => {
    const team = await createTeamFor(admin, 'Comercial')
    await db.insert(leads).values({ tenantId: f.tenant.id, teamId: team.id, name: 'Lead' })

    await expect(deleteTeamFor(admin, team.id)).rejects.toThrow('Equipe tem membros, tarefas, desafios ou leads')
  })

  it('recusa equipe com desafios', async () => {
    const team = await createTeamFor(admin, 'Com desafio')
    await db.insert(challenges).values({ tenantId: f.tenant.id, teamId: team.id, title: 'Rápido', estimatedSeconds: 60 })

    await expect(deleteTeamFor(admin, team.id)).rejects.toThrow('Equipe tem membros, tarefas, desafios ou leads')
  })

  it('recusa equipe com membros, citando-os na mensagem', async () => {
    const team = await createTeamFor(admin, 'Com gente')
    await addUser(f, { role: 'MEMBER', team })

    await expect(deleteTeamFor(admin, team.id)).rejects.toThrow('Equipe tem membros, tarefas, desafios ou leads')
  })

  it('recusa equipe cujo único membro tem vínculo só em team_members', async () => {
    const team = await createTeamFor(admin, 'Só vínculo')
    await joinTeam(f, (await addUser(f, { role: 'MEMBER', team: null })).userId, team)

    await expect(deleteTeamFor(admin, team.id)).rejects.toThrow('Equipe tem membros, tarefas, desafios ou leads')
  })

  it('exclui equipe vazia', async () => {
    const team = await createTeamFor(admin, 'Vazia')

    await expect(deleteTeamFor(admin, team.id)).resolves.toBeUndefined()
  })
})

describe('listas por vínculo', () => {
  it('listTeamsFor conta os membros por team_members', async () => {
    const team = await createTeamFor(admin, 'Contada')
    const second = await createTeamFor(admin, 'Outra contada')
    const [a, b] = [await addUser(f, { role: 'MEMBER', team }), await addUser(f, { role: 'MEMBER', team: null })]
    await joinTeam(f, b.userId, team)
    await joinTeam(f, a.userId, second)

    const list = await listTeamsFor(admin)

    expect(list.find((t) => t.id === team.id)).toMatchObject({ members: 2 })
    expect(list.find((t) => t.id === second.id)).toMatchObject({ members: 1 })
  })

  it('tenantMembersOf traz todas as equipes de cada pessoa', async () => {
    const [x, y] = [await createTeamFor(admin, 'X-sa'), await createTeamFor(admin, 'Y-sa')]
    const both = await joinTeam(f, (await addUser(f, { role: 'MEMBER', team: x })).userId, y)
    const none = await addUser(f, { role: 'MEMBER', team: null })

    const members = await tenantMembersOf(f.tenant.id)

    expect(members.find((m) => m.id === both.userId)!.teams).toEqual(['X-sa', 'Y-sa'])
    expect(members.find((m) => m.id === none.userId)!.teams).toEqual([])
  })
})
