import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { leads, opportunities, pipelineStages } from '#/db/schema'
import { importLeadsFor, previewLeadImportFor } from './leads-import.core'
import { assignLeadFor, claimLeadFor, createLeadFor, deleteLeadFor, updateLeadFor } from './leads.core'
import { convertLeadFor, createOpportunityFor, moveOpportunityFor, updateOpportunityFor } from './pipeline.core'
import type { AuthCtx } from './roles'
import { ForbiddenError } from './roles'
import { addLead, addOpportunity } from './test-crm-fixtures'
import { addTeam, addUser, joinTeam, makeTenant } from './test-fixtures'

type Fixture = Awaited<ReturnType<typeof makeTenant>>

let f: Fixture
let teamA: { id: string }
let teamB: { id: string }
let membersCannotWrite: AuthCtx
let leadersCannotWrite: AuthCtx
let membersOnlyImport: AuthCtx

const leaderOfAMemberOfB = async (capabilityOverrides: AuthCtx['capabilityOverrides']) => {
  const leader = await addUser(f, { role: 'MEMBER', team: teamA, teamRole: 'LEADER' })
  return { ...(await joinTeam(f, leader.userId, teamB, 'MEMBER')), capabilityOverrides }
}

beforeAll(async () => {
  f = await makeTenant(0)
  teamA = f.team
  teamB = await addTeam(f)
  membersCannotWrite = await leaderOfAMemberOfB({ MEMBER: { 'lead.write': false, 'opportunity.write': false } })
  leadersCannotWrite = await leaderOfAMemberOfB({ LEADER: { 'lead.write': false, 'opportunity.write': false } })
  membersOnlyImport = await leaderOfAMemberOfB({ MEMBER: { 'lead.import': true }, LEADER: { 'lead.import': false } })
})
afterAll(async () => {
  await f.cleanup()
  await db.$client.end()
})

const edit = { name: 'Outro nome', source: 'site', status: 'contacted' } as const
const deal = { title: 'Contrato', amountCents: 10_000 }
const dealEdit = (ownerId: string | null) => ({ title: 'Novo título', amountCents: 20_000, expectedCloseDate: null, ownerId })

const lostStage = async () => (await db.select().from(pipelineStages).where(and(eq(pipelineStages.pipelineId, f.pipeline.id), eq(pipelineStages.kind, 'lost'))))[0]!
const ownerOfLead = async (id: string) => (await db.select().from(leads).where(eq(leads.id, id)))[0]!.ownerId

describe('lead.write vale na equipe do lead, não em qualquer equipe da pessoa', () => {
  it('quem lidera A e é membro de B, com MEMBER sem lead.write, cria lead em A e não em B', async () => {
    const me = membersCannotWrite

    await expect(createLeadFor(me, { name: 'Em A', teamId: teamA.id })).resolves.toMatchObject({ created: true })
    await expect(createLeadFor(me, { name: 'Em B', teamId: teamB.id })).rejects.toThrow(ForbiddenError)
  })

  it('edita o lead de A e não o de B, mesmo sendo dono dos dois', async () => {
    const me = membersCannotWrite
    const [inA, inB] = [await addLead(f, teamA.id, me.userId), await addLead(f, teamB.id, me.userId)]

    await expect(updateLeadFor(me, inA.id, edit)).resolves.toBeUndefined()
    await expect(updateLeadFor(me, inB.id, edit)).rejects.toThrow(ForbiddenError)
  })

  it('assume lead do pool de A e não o de B', async () => {
    const me = membersCannotWrite
    const [inA, inB] = [await addLead(f, teamA.id), await addLead(f, teamB.id)]

    await expect(claimLeadFor(me, inA.id)).resolves.toMatchObject({ ownerId: me.userId })
    await expect(claimLeadFor(me, inB.id)).rejects.toThrow('Lead indisponível')
    expect(await ownerOfLead(inB.id)).toBeNull()
  })

  it('quem só é membro de equipes sem lead.write não assume lead', async () => {
    const me = { ...(await addUser(f, { role: 'MEMBER', team: teamB })), capabilityOverrides: { MEMBER: { 'lead.write': false } } }
    const lead = await addLead(f, teamB.id)

    await expect(claimLeadFor(me, lead.id)).rejects.toThrow(ForbiddenError)
  })

  it('LEADER sem lead.write não atribui nem exclui lead da equipe que lidera, mesmo com MEMBER podendo', async () => {
    const me = leadersCannotWrite
    const lead = await addLead(f, teamA.id)

    await expect(assignLeadFor(me, lead.id, me.userId)).rejects.toThrow(ForbiddenError)
    await expect(deleteLeadFor(me, lead.id)).rejects.toThrow(ForbiddenError)
  })

  it('LEADER sem lead.write continua editando o lead de B, onde é membro e MEMBER pode', async () => {
    const me = leadersCannotWrite
    const [inA, inB] = [await addLead(f, teamA.id, me.userId), await addLead(f, teamB.id, me.userId)]

    await expect(updateLeadFor(me, inA.id, edit)).rejects.toThrow(ForbiddenError)
    await expect(updateLeadFor(me, inB.id, edit)).resolves.toBeUndefined()
  })
})

describe('lead.import vale na equipe da importação', () => {
  const request = (teamId: string) => ({ teamId, rows: [{ name: 'Importado' }] })

  it('quem lidera A (LEADER sem lead.import) e é membro de B (MEMBER com lead.import) não importa para A', async () => {
    const me = membersOnlyImport

    await expect(previewLeadImportFor(me, request(teamA.id))).rejects.toThrow(ForbiddenError)
    await expect(importLeadsFor(me, { ...request(teamA.id), onDuplicate: 'skip', distribute: 'none' })).rejects.toThrow(ForbiddenError)
  })
})

describe('opportunity.write vale na equipe da oportunidade', () => {
  it('cria oportunidade para lead de A e não para o de B', async () => {
    const me = membersCannotWrite
    const [inA, inB] = [await addLead(f, teamA.id), await addLead(f, teamB.id)]

    await expect(createOpportunityFor(me, inA.id, deal)).resolves.toMatchObject({ teamId: teamA.id })
    await expect(createOpportunityFor(me, inB.id, deal)).rejects.toThrow(ForbiddenError)
  })

  it('converte lead de A e não o de B, e o lead de B continua como estava', async () => {
    const me = membersCannotWrite
    const [inA, inB] = [await addLead(f, teamA.id, me.userId), await addLead(f, teamB.id, me.userId)]

    await expect(convertLeadFor(me, inA.id, deal)).resolves.toMatchObject({ teamId: teamA.id })
    await expect(convertLeadFor(me, inB.id, deal)).rejects.toThrow(ForbiddenError)
    expect((await db.select().from(leads).where(eq(leads.id, inB.id)))[0]!.status).toBe('new')
  })

  it('edita a oportunidade de A e não a de B, mesmo sendo dona das duas', async () => {
    const me = membersCannotWrite
    const [inA, inB] = [await addOpportunity(f, await addLead(f, teamA.id), me.userId), await addOpportunity(f, await addLead(f, teamB.id), me.userId)]

    await expect(updateOpportunityFor(me, inA.id, dealEdit(me.userId))).resolves.toMatchObject({ title: 'Novo título' })
    await expect(updateOpportunityFor(me, inB.id, dealEdit(me.userId))).rejects.toThrow(ForbiddenError)
  })

  it('move a oportunidade de A e não a de B, mesmo sendo dona das duas', async () => {
    const me = membersCannotWrite
    const [inA, inB] = [await addOpportunity(f, await addLead(f, teamA.id), me.userId), await addOpportunity(f, await addLead(f, teamB.id), me.userId)]
    const lost = await lostStage()

    await expect(moveOpportunityFor(me, inA.id, lost.id, { lostReason: 'Sem orçamento' })).resolves.toMatchObject({ stageId: lost.id })
    await expect(moveOpportunityFor(me, inB.id, lost.id, { lostReason: 'Sem orçamento' })).rejects.toThrow(ForbiddenError)
    expect((await db.select().from(opportunities).where(eq(opportunities.id, inB.id)))[0]!.stageId).toBe(inB.stageId)
  })

  it('LEADER sem opportunity.write não edita a oportunidade da equipe que lidera, e edita a de B, onde MEMBER pode', async () => {
    const me = leadersCannotWrite
    const [inA, inB] = [await addOpportunity(f, await addLead(f, teamA.id), me.userId), await addOpportunity(f, await addLead(f, teamB.id), me.userId)]

    await expect(updateOpportunityFor(me, inA.id, dealEdit(me.userId))).rejects.toThrow(ForbiddenError)
    await expect(updateOpportunityFor(me, inB.id, dealEdit(me.userId))).resolves.toMatchObject({ title: 'Novo título' })
  })
})
