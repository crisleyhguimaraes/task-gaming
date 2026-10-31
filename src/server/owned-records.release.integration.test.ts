import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { auditEvents, leads, opportunities } from '#/db/schema'
import { getLeadFor, updateLeadFor } from './leads.core'
import { listNotesFor } from './notes.core'
import { getOpportunityFor, updateOpportunityFor } from './pipeline.core'
import type { AuthCtx } from './roles'
import { removeTeamMemberFor } from './team-members.core'
import { addLead, addOpportunity } from './test-crm-fixtures'
import { addAdmin, addTeam, addUser, ctxFor, joinTeam, makeTenant } from './test-fixtures'
import { deactivateUserCore } from './users.core'

type Fixture = Awaited<ReturnType<typeof makeTenant>>

let f: Fixture
let teamB: { id: string }
let admin: AuthCtx

beforeAll(async () => {
  f = await makeTenant(0)
  teamB = await addTeam(f)
  admin = await addAdmin(f)
})
afterAll(async () => {
  await f.cleanup()
  await db.$client.end()
})

const newMember = () => addUser(f, { role: 'MEMBER', team: f.team })

const ownerOfLead = async (id: string) => (await db.select().from(leads).where(eq(leads.id, id)))[0]!.ownerId
const ownerOfOpportunity = async (id: string) => (await db.select().from(opportunities).where(eq(opportunities.id, id)))[0]!.ownerId

const eventOf = async (action: 'team.member_removed' | 'user.deactivated', entityId: string) =>
  (await db.select().from(auditEvents).where(and(eq(auditEvents.tenantId, f.tenant.id), eq(auditEvents.action, action), eq(auditEvents.entityId, entityId))))[0]!

const edit = { name: 'Outro nome', source: 'site', status: 'contacted' } as const

describe('quem sai da equipe', () => {
  it('perde o acesso ao lead que era dele, e o lead volta ao pool', async () => {
    const leaver = await newMember()
    const lead = await addLead(f, f.team.id, leaver.userId)

    await removeTeamMemberFor(admin, { userId: leaver.userId, teamId: f.team.id })

    const afterLeaving = await ctxFor(leaver.userId)
    await expect(getLeadFor(afterLeaving, lead.id)).rejects.toThrow('Lead não encontrado')
    await expect(updateLeadFor(afterLeaving, lead.id, edit)).rejects.toThrow('Lead não encontrado')
    expect(await ownerOfLead(lead.id)).toBeNull()
  })

  it('perde o acesso à oportunidade aberta que era dela, e a oportunidade fica sem dono', async () => {
    const leaver = await newMember()
    const opportunity = await addOpportunity(f, await addLead(f, f.team.id, null), leaver.userId)

    await removeTeamMemberFor(admin, { userId: leaver.userId, teamId: f.team.id })

    const afterLeaving = await ctxFor(leaver.userId)
    await expect(getOpportunityFor(afterLeaving, opportunity.id)).rejects.toThrow('Oportunidade não encontrada')
    await expect(updateOpportunityFor(afterLeaving, opportunity.id, { title: 'Novo', amountCents: 1, expectedCloseDate: null, ownerId: null })).rejects.toThrow(
      'Oportunidade não encontrada',
    )
    expect(await ownerOfOpportunity(opportunity.id)).toBeNull()
  })

  it('deixa a oportunidade fechada com o dono, porque é histórico', async () => {
    const leaver = await newMember()
    const won = await addOpportunity(f, await addLead(f, f.team.id, null), leaver.userId, 'won')

    await removeTeamMemberFor(admin, { userId: leaver.userId, teamId: f.team.id })

    expect(await ownerOfOpportunity(won.id)).toBe(leaver.userId)
  })

  it('perde a leitura da oportunidade fechada que era dele, embora o histórico guarde o nome', async () => {
    const leaver = await newMember()
    const won = await addOpportunity(f, await addLead(f, f.team.id, null), leaver.userId, 'won')

    await removeTeamMemberFor(admin, { userId: leaver.userId, teamId: f.team.id })

    const afterLeaving = await ctxFor(leaver.userId)
    await expect(getOpportunityFor(afterLeaving, won.id)).rejects.toThrow('Oportunidade não encontrada')
    await expect(listNotesFor(afterLeaving, { type: 'opportunity', id: won.id })).rejects.toThrow('Registro não encontrado')
    expect(await ownerOfOpportunity(won.id)).toBe(leaver.userId)
  })

  it('não mexe no que é dos colegas', async () => {
    const [leaver, colleague] = [await newMember(), await newMember()]
    const colleagueLead = await addLead(f, f.team.id, colleague.userId)
    const colleagueOpportunity = await addOpportunity(f, colleagueLead, colleague.userId)

    await removeTeamMemberFor(admin, { userId: leaver.userId, teamId: f.team.id })

    expect(await ownerOfLead(colleagueLead.id)).toBe(colleague.userId)
    expect(await ownerOfOpportunity(colleagueOpportunity.id)).toBe(colleague.userId)
  })

  it('que continua em outra equipe mantém o que é dela e perde só o da equipe de onde saiu', async () => {
    const leaver = await newMember()
    await joinTeam(f, leaver.userId, teamB)
    const [leadA, leadB] = [await addLead(f, f.team.id, leaver.userId), await addLead(f, teamB.id, leaver.userId)]
    const [opportunityA, opportunityB] = [await addOpportunity(f, leadA, leaver.userId), await addOpportunity(f, leadB, leaver.userId)]

    await removeTeamMemberFor(admin, { userId: leaver.userId, teamId: f.team.id })

    const afterLeaving = await ctxFor(leaver.userId)
    expect(await ownerOfLead(leadA.id)).toBeNull()
    expect(await ownerOfOpportunity(opportunityA.id)).toBeNull()
    expect(await ownerOfLead(leadB.id)).toBe(leaver.userId)
    expect(await ownerOfOpportunity(opportunityB.id)).toBe(leaver.userId)
    await expect(getLeadFor(afterLeaving, leadB.id)).resolves.toMatchObject({ canEdit: true })
  })

  it('registra no evento da saída quantos leads e oportunidades abertas devolveu', async () => {
    const leaver = await newMember()
    const lead = await addLead(f, f.team.id, leaver.userId)
    await addLead(f, f.team.id, leaver.userId)
    await addOpportunity(f, lead, leaver.userId)
    await addOpportunity(f, lead, leaver.userId, 'won')

    await removeTeamMemberFor(admin, { userId: leaver.userId, teamId: f.team.id })

    expect((await eventOf('team.member_removed', f.team.id)).meta).toMatchObject({ userId: leaver.userId, releasedLeads: 2, releasedOpportunities: 1 })
  })
})

describe('quem é desativado', () => {
  it('perde os leads e as oportunidades abertas de todas as equipes', async () => {
    const deactivated = await newMember()
    await joinTeam(f, deactivated.userId, teamB)
    const [leadA, leadB] = [await addLead(f, f.team.id, deactivated.userId), await addLead(f, teamB.id, deactivated.userId)]
    const [opportunityA, opportunityB] = [await addOpportunity(f, leadA, deactivated.userId), await addOpportunity(f, leadB, deactivated.userId)]
    const won = await addOpportunity(f, leadB, deactivated.userId, 'won')

    await deactivateUserCore(admin, deactivated.userId)

    expect(await ownerOfLead(leadA.id)).toBeNull()
    expect(await ownerOfLead(leadB.id)).toBeNull()
    expect(await ownerOfOpportunity(opportunityA.id)).toBeNull()
    expect(await ownerOfOpportunity(opportunityB.id)).toBeNull()
    expect(await ownerOfOpportunity(won.id)).toBe(deactivated.userId)
  })

  it('registra no evento da desativação quantos leads e oportunidades abertas devolveu', async () => {
    const deactivated = await newMember()
    const lead = await addLead(f, f.team.id, deactivated.userId)
    await addOpportunity(f, lead, deactivated.userId)

    await deactivateUserCore(admin, deactivated.userId, 'Saiu da empresa')

    expect((await eventOf('user.deactivated', deactivated.userId)).meta).toEqual({ reason: 'Saiu da empresa', releasedLeads: 1, releasedOpportunities: 1 })
  })
})
