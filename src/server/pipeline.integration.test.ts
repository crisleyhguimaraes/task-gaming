import { and, asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { auditEvents, leads, opportunities, opportunityStageChanges, pipelineStages, teams, users } from '#/db/schema'
import { convertLeadFor, createOpportunityFor, funnelFor, getOpportunityFor, listPipelineFor, moveOpportunityFor, pipelineFiltersFor, updateOpportunityFor } from './pipeline.core'
import type { AuthCtx } from './roles'
import { createStageFor, reorderStageFor } from './stages.core'
import { createTaskFor } from './tasks.core'
import { addAdmin, addTeam, addUser, makeTenant } from './test-fixtures'

type Fixture = Awaited<ReturnType<typeof makeTenant>>

let f: Fixture
let other: Fixture
let admin: AuthCtx
let otherAdmin: AuthCtx
let outsider: AuthCtx
let teamB: { id: string }
const DAY_MS = 86_400_000

async function addTeamB() {
  const [team] = await db.insert(teams).values({ tenantId: f.tenant.id, name: 'Equipe B' }).returning()
  const id = `b-${f.tenant.slug}`
  await db.insert(users).values({ id, name: 'Fora', email: `${id}@test.local`, role: 'MEMBER', tenantId: f.tenant.id, teamId: team!.id })
  outsider = { userId: id, tenantId: f.tenant.id, teamId: team!.id, role: 'MEMBER', name: 'Fora', impersonatedBy: null, mustChangePassword: false }
  teamB = team!
}

async function newLead(tenant: Fixture, opts: { teamId?: string; ownerId?: string | null } = {}) {
  const [lead] = await db
    .insert(leads)
    .values({ tenantId: tenant.tenant.id, teamId: opts.teamId ?? tenant.team.id, ownerId: opts.ownerId ?? null, name: 'Maria Souza' })
    .returning()
  return lead!
}

const stageId = async (tenant: Fixture, name: string) => {
  const [stage] = await db.select().from(pipelineStages).where(and(eq(pipelineStages.tenantId, tenant.tenant.id), eq(pipelineStages.name, name)))
  return stage!.id
}

const deal = (overrides: Partial<Parameters<typeof createOpportunityFor>[2]> = {}) => ({ title: 'Contrato anual', amountCents: 100_000, expectedCloseDate: '2026-12-31', ...overrides })

async function newOpportunity(me: AuthCtx, tenant = f, data = deal(), lead?: { id: string }) {
  return createOpportunityFor(me, (lead ?? (await newLead(tenant, { teamId: me.teamId ?? tenant.team.id }))).id, data)
}

const reload = async (id: string) => (await db.select().from(opportunities).where(eq(opportunities.id, id)))[0]!

const auditFor = (entityId: string) =>
  db.select().from(auditEvents).where(eq(auditEvents.entityId, entityId)).orderBy(asc(auditEvents.createdAt), asc(auditEvents.id))

const actionsFor = async (entityId: string) => (await auditFor(entityId)).map((e) => e.action)

const stageChangesOf = (opportunityId: string) =>
  db.select().from(opportunityStageChanges).where(eq(opportunityStageChanges.opportunityId, opportunityId)).orderBy(asc(opportunityStageChanges.changedAt), asc(opportunityStageChanges.id))

beforeAll(async () => {
  f = await makeTenant(2)
  other = await makeTenant(0)
  admin = await addAdmin(f)
  otherAdmin = await addAdmin(other)
  await addTeamB()
})
afterAll(async () => {
  await f.cleanup()
  await other.cleanup()
  await db.$client.end()
})

describe('createOpportunityFor', () => {
  it('nasce na primeira etapa aberta, na equipe do lead, com a primeira mudança de etapa e auditoria', async () => {
    const lead = await newLead(f)

    const opp = await createOpportunityFor(f.members[0]!, lead.id, deal())

    expect(opp).toMatchObject({ tenantId: f.tenant.id, teamId: f.team.id, leadId: lead.id, title: 'Contrato anual', amountCents: 100_000, expectedCloseDate: '2026-12-31', ownerId: null, closedAt: null })
    expect(opp.stageId).toBe(await stageId(f, 'Novo'))
    expect(await stageChangesOf(opp.id)).toMatchObject([{ fromStageId: null, toStageId: opp.stageId, changedById: f.members[0]!.userId }])
    expect(await actionsFor(opp.id)).toEqual(['opportunity.created'])
  })

  it('a etapa inicial é a primeira aberta pela ordem configurada', async () => {
    const solo = await makeTenant(0)
    try {
      const soloAdmin = await addAdmin(solo)
      const first = await createStageFor(soloAdmin, { name: 'Prospecção', kind: 'open', probability: 5 })
      await reorderStageFor(soloAdmin, first.id, 0)
      const lead = await newLead(solo)

      const opp = await createOpportunityFor(soloAdmin, lead.id, deal())

      expect(opp.stageId).toBe(first.id)
    } finally {
      await solo.cleanup()
    }
  })

  it('recusa título curto e valor negativo, fracionário ou fora do inteiro seguro', async () => {
    const lead = await newLead(f)

    await expect(createOpportunityFor(f.leader, lead.id, deal({ title: ' a ' }))).rejects.toThrow('título')
    await expect(createOpportunityFor(f.leader, lead.id, deal({ amountCents: -1 }))).rejects.toThrow('valor')
    await expect(createOpportunityFor(f.leader, lead.id, deal({ amountCents: 10.5 }))).rejects.toThrow('valor')
    await expect(createOpportunityFor(f.leader, lead.id, deal({ amountCents: Number.MAX_SAFE_INTEGER + 2 }))).rejects.toThrow('valor')
    expect(await db.select().from(opportunities).where(eq(opportunities.leadId, lead.id))).toHaveLength(0)
  })

  it('usa o relógio injetado como data de criação e de entrada na primeira etapa', async () => {
    const lead = await newLead(f)
    const at = new Date('2026-01-10T09:00:00Z')

    const opp = await createOpportunityFor(f.leader, lead.id, deal(), at)

    expect(opp.createdAt).toEqual(at)
    expect((await stageChangesOf(opp.id))[0]!.changedAt).toEqual(at)
  })

  it('aceita valor zero', async () => {
    const opp = await newOpportunity(f.leader, f, deal({ amountCents: 0 }))

    expect(opp.amountCents).toBe(0)
  })

  it('não usa lead de outro tenant nem de outra equipe', async () => {
    const foreign = await newLead(other)
    const teamBLead = await newLead(f, { teamId: teamB.id })

    await expect(createOpportunityFor(f.leader, foreign.id, deal())).rejects.toThrow('Lead não encontrado')
    await expect(createOpportunityFor(f.members[0]!, teamBLead.id, deal())).rejects.toThrow('Lead não encontrado')
  })

  it('o gestor geral cria em lead de qualquer equipe do tenant', async () => {
    const teamBLead = await newLead(f, { teamId: teamB.id })

    const opp = await createOpportunityFor(admin, teamBLead.id, deal())

    expect(opp.teamId).toBe(teamB.id)
  })

  it('o dono precisa ser da equipe do lead', async () => {
    const lead = await newLead(f)

    await expect(createOpportunityFor(f.leader, lead.id, deal({ ownerId: outsider.userId }))).rejects.toThrow('Responsável não pertence à equipe')
    const opp = await createOpportunityFor(f.leader, lead.id, deal({ ownerId: f.members[1]!.userId }))
    expect(opp.ownerId).toBe(f.members[1]!.userId)
  })

  it('não atribui a usuário desativado', async () => {
    const lead = await newLead(f)
    const deactivated = await addUser(f, { role: 'MEMBER', team: f.team })
    await db.update(users).set({ banned: true }).where(eq(users.id, deactivated.userId))

    await expect(createOpportunityFor(f.leader, lead.id, deal({ ownerId: deactivated.userId }))).rejects.toThrow('Responsável não pertence à equipe')
    const opp = await newOpportunity(f.leader)
    await expect(updateOpportunityFor(f.leader, opp.id, { ...deal(), ownerId: deactivated.userId })).rejects.toThrow('Responsável não pertence à equipe')
  })
})

describe('convertLeadFor', () => {
  it('cria a oportunidade na primeira etapa aberta e qualifica o lead, com as duas auditorias', async () => {
    const lead = await newLead(f)

    const opp = await convertLeadFor(f.members[0]!, lead.id, deal())

    expect(opp).toMatchObject({ leadId: lead.id, teamId: f.team.id })
    expect(opp.stageId).toBe(await stageId(f, 'Novo'))
    expect((await db.select().from(leads).where(eq(leads.id, lead.id)))[0]!.status).toBe('qualified')
    expect(await actionsFor(opp.id)).toEqual(['opportunity.created'])
    const [leadEvent] = await auditFor(lead.id)
    expect(leadEvent).toMatchObject({ action: 'lead.updated', entityType: 'lead', changes: { status: { from: 'new', to: 'qualified' } } })
  })

  it('um lead pode gerar várias oportunidades', async () => {
    const lead = await newLead(f)

    await convertLeadFor(f.leader, lead.id, deal({ title: 'Primeiro' }))
    await convertLeadFor(f.leader, lead.id, deal({ title: 'Segundo' }))

    expect(await db.select().from(opportunities).where(eq(opportunities.leadId, lead.id))).toHaveLength(2)
  })

  it('herda o dono do lead quando nenhum é informado', async () => {
    const lead = await newLead(f, { ownerId: f.members[1]!.userId })

    const opp = await convertLeadFor(f.leader, lead.id, deal())

    expect(opp.ownerId).toBe(f.members[1]!.userId)
  })

  it('é atômica: se a oportunidade falha, o lead continua como estava', async () => {
    const lead = await newLead(f)

    await expect(convertLeadFor(f.leader, lead.id, deal({ ownerId: outsider.userId }))).rejects.toThrow('Responsável não pertence à equipe')

    expect((await db.select().from(leads).where(eq(leads.id, lead.id)))[0]!.status).toBe('new')
    expect(await db.select().from(opportunities).where(eq(opportunities.leadId, lead.id))).toHaveLength(0)
    expect(await auditFor(lead.id)).toHaveLength(0)
  })

  it('não converte lead de outro tenant, de outra equipe nem de colega', async () => {
    const foreign = await newLead(other)
    const teamBLead = await newLead(f, { teamId: teamB.id })
    const teammatesLead = await newLead(f, { ownerId: f.members[1]!.userId })

    await expect(convertLeadFor(f.leader, foreign.id, deal())).rejects.toThrow('Lead não encontrado')
    await expect(convertLeadFor(f.members[0]!, teamBLead.id, deal())).rejects.toThrow('Lead não encontrado')
    await expect(convertLeadFor(f.members[0]!, teammatesLead.id, deal())).rejects.toThrow('Sem permissão')
    expect((await db.select().from(leads).where(eq(leads.id, teammatesLead.id)))[0]!.status).toBe('new')
  })
})

describe('updateOpportunityFor', () => {
  it('altera os dados e audita só o que mudou', async () => {
    const opp = await newOpportunity(f.leader)

    await updateOpportunityFor(f.leader, opp.id, { title: 'Contrato anual', amountCents: 250_000, expectedCloseDate: '2027-01-15', ownerId: f.members[0]!.userId })

    expect(await reload(opp.id)).toMatchObject({ amountCents: 250_000, expectedCloseDate: '2027-01-15', ownerId: f.members[0]!.userId })
    const [, updated] = await auditFor(opp.id)
    expect(updated).toMatchObject({
      action: 'opportunity.updated',
      changes: { amountCents: { from: 100_000, to: 250_000 }, expectedCloseDate: { from: '2026-12-31', to: '2027-01-15' }, ownerId: { from: null, to: f.members[0]!.userId } },
    })
  })

  it('sem mudança real não gera evento', async () => {
    const opp = await newOpportunity(f.leader)

    await updateOpportunityFor(f.leader, opp.id, { title: opp.title, amountCents: opp.amountCents, expectedCloseDate: opp.expectedCloseDate, ownerId: null })

    expect(await actionsFor(opp.id)).toEqual(['opportunity.created'])
  })

  it('valida os campos e o dono', async () => {
    const opp = await newOpportunity(f.leader)

    await expect(updateOpportunityFor(f.leader, opp.id, { ...deal(), amountCents: -5, ownerId: null })).rejects.toThrow('valor')
    await expect(updateOpportunityFor(f.leader, opp.id, { ...deal(), ownerId: outsider.userId })).rejects.toThrow('Responsável não pertence à equipe')
  })

  it('só o dono ou um gestor edita oportunidade que tem dono; sem dono, qualquer um da equipe', async () => {
    const owned = await newOpportunity(f.leader, f, deal({ ownerId: f.members[0]!.userId }))
    const unowned = await newOpportunity(f.leader)

    await expect(updateOpportunityFor(f.members[1]!, owned.id, { ...deal(), ownerId: owned.ownerId })).rejects.toThrow('Sem permissão')
    await updateOpportunityFor(f.members[0]!, owned.id, { ...deal({ title: 'Do dono' }), ownerId: owned.ownerId })
    await updateOpportunityFor(f.members[1]!, unowned.id, { ...deal({ title: 'De qualquer um' }), ownerId: null })
    expect((await reload(owned.id)).title).toBe('Do dono')
    expect((await reload(unowned.id)).title).toBe('De qualquer um')
  })

  it('não enxerga nem edita oportunidade de outra equipe ou de outro tenant', async () => {
    const mine = await newOpportunity(f.leader)

    await expect(updateOpportunityFor(outsider, mine.id, { ...deal(), ownerId: null })).rejects.toThrow('Oportunidade não encontrada')
    await expect(updateOpportunityFor(otherAdmin, mine.id, { ...deal(), ownerId: null })).rejects.toThrow('Oportunidade não encontrada')
  })
})

describe('moveOpportunityFor', () => {
  it('mover entre etapas abertas grava a mudança, a ordem e a auditoria, sem fechar', async () => {
    const opp = await newOpportunity(f.leader)
    const qualified = await stageId(f, 'Qualificado')

    await moveOpportunityFor(f.leader, opp.id, qualified, { sortOrder: 42 })

    expect(await reload(opp.id)).toMatchObject({ stageId: qualified, sortOrder: 42, closedAt: null })
    const changes = await stageChangesOf(opp.id)
    expect(changes.at(-1)).toMatchObject({ fromStageId: opp.stageId, toStageId: qualified, changedById: f.leader.userId })
    const events = await auditFor(opp.id)
    expect(events.at(-1)).toMatchObject({ action: 'opportunity.moved', meta: { fromStage: 'Novo', toStage: 'Qualificado' } })
  })

  it('perder exige motivo de ao menos 3 caracteres e nada muda sem ele', async () => {
    const opp = await newOpportunity(f.leader)
    const lost = await stageId(f, 'Perdida')

    await expect(moveOpportunityFor(f.leader, opp.id, lost, {})).rejects.toThrow('motivo')
    await expect(moveOpportunityFor(f.leader, opp.id, lost, { lostReason: ' ab ' })).rejects.toThrow('motivo')

    expect(await reload(opp.id)).toMatchObject({ stageId: opp.stageId, closedAt: null, lostReason: null })
    expect(await stageChangesOf(opp.id)).toHaveLength(1)
  })

  it('perder preenche closed_at e o motivo, e audita como perdida', async () => {
    const opp = await newOpportunity(f.leader)
    const lost = await stageId(f, 'Perdida')

    await moveOpportunityFor(f.leader, opp.id, lost, { lostReason: '  Preço acima do orçamento ' })

    const row = await reload(opp.id)
    expect(row.stageId).toBe(lost)
    expect(row.lostReason).toBe('Preço acima do orçamento')
    expect(row.closedAt).toBeInstanceOf(Date)
    expect((await auditFor(opp.id)).at(-1)).toMatchObject({ action: 'opportunity.lost', meta: { toStage: 'Perdida', lostReason: 'Preço acima do orçamento' } })
  })

  it('ganhar preenche closed_at, não guarda motivo e audita como ganha', async () => {
    const opp = await newOpportunity(f.leader)

    await moveOpportunityFor(f.leader, opp.id, await stageId(f, 'Ganha'), { lostReason: 'ignorado' })

    const row = await reload(opp.id)
    expect(row.closedAt).toBeInstanceOf(Date)
    expect(row.lostReason).toBeNull()
    expect((await auditFor(opp.id)).at(-1)!.action).toBe('opportunity.won')
  })

  it('sair de etapa fechada exige opportunity.reopen e limpa closed_at e motivo', async () => {
    const opp = await newOpportunity(f.leader, f, deal({ ownerId: f.members[0]!.userId }))
    const member = f.members[0]!
    await moveOpportunityFor(member, opp.id, await stageId(f, 'Perdida'), { lostReason: 'Sem retorno do cliente' })

    await expect(moveOpportunityFor(member, opp.id, await stageId(f, 'Negociação'), {})).rejects.toThrow('Sem permissão')
    expect((await reload(opp.id)).closedAt).not.toBeNull()

    await moveOpportunityFor(f.leader, opp.id, await stageId(f, 'Negociação'), {})

    expect(await reload(opp.id)).toMatchObject({ closedAt: null, lostReason: null })
    expect((await auditFor(opp.id)).at(-1)).toMatchObject({ action: 'opportunity.reopened', meta: { fromStage: 'Perdida', toStage: 'Negociação' } })
  })

  it('trocar uma etapa fechada por outra fechada também é reabrir, e a nova classificação vale', async () => {
    const opp = await newOpportunity(f.leader, f, deal({ ownerId: f.members[0]!.userId }))
    await moveOpportunityFor(f.leader, opp.id, await stageId(f, 'Ganha'), {})

    await expect(moveOpportunityFor(f.members[0]!, opp.id, await stageId(f, 'Perdida'), { lostReason: 'Desistiu' })).rejects.toThrow('Sem permissão')
    await moveOpportunityFor(f.leader, opp.id, await stageId(f, 'Perdida'), { lostReason: 'Desistiu' })

    expect(await reload(opp.id)).toMatchObject({ lostReason: 'Desistiu' })
    expect((await auditFor(opp.id)).at(-1)!.action).toBe('opportunity.lost')
  })

  it('usa o relógio injetado ao fechar e ao registrar a mudança de etapa', async () => {
    const opp = await newOpportunity(f.leader)
    const at = new Date('2026-01-15T10:00:00Z')

    await moveOpportunityFor(f.leader, opp.id, await stageId(f, 'Ganha'), {}, at)

    expect((await reload(opp.id)).closedAt).toEqual(at)
    expect((await stageChangesOf(opp.id)).find((change) => change.fromStageId !== null)!.changedAt).toEqual(at)
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY])('recusa posição não finita (%s) e nada muda', async (sortOrder) => {
    const opp = await newOpportunity(f.leader)

    await expect(moveOpportunityFor(f.leader, opp.id, opp.stageId, { sortOrder })).rejects.toThrow('Posição inválida')
    await expect(moveOpportunityFor(f.leader, opp.id, await stageId(f, 'Qualificado'), { sortOrder })).rejects.toThrow('Posição inválida')

    expect(await reload(opp.id)).toMatchObject({ stageId: opp.stageId, sortOrder: opp.sortOrder })
  })

  it('soltar na mesma etapa só reordena: sem mudança de etapa nem auditoria', async () => {
    const opp = await newOpportunity(f.leader)

    await moveOpportunityFor(f.leader, opp.id, opp.stageId, { sortOrder: 7 })

    expect((await reload(opp.id)).sortOrder).toBe(7)
    expect(await stageChangesOf(opp.id)).toHaveLength(1)
    expect(await actionsFor(opp.id)).toEqual(['opportunity.created'])
  })

  it('sem posição informada, vai para o fim da etapa de destino', async () => {
    const first = await newOpportunity(f.leader)
    const second = await newOpportunity(f.leader)
    const proposal = await stageId(f, 'Proposta')
    await moveOpportunityFor(f.leader, first.id, proposal, { sortOrder: 500 })

    await moveOpportunityFor(f.leader, second.id, proposal, {})

    expect((await reload(second.id)).sortOrder).toBeGreaterThan(500)
  })

  it('só o dono ou um gestor move oportunidade que tem dono', async () => {
    const opp = await newOpportunity(f.leader, f, deal({ ownerId: f.members[0]!.userId }))

    await expect(moveOpportunityFor(f.members[1]!, opp.id, await stageId(f, 'Qualificado'), {})).rejects.toThrow('Sem permissão')
    await moveOpportunityFor(f.members[0]!, opp.id, await stageId(f, 'Qualificado'), {})
    expect((await reload(opp.id)).stageId).toBe(await stageId(f, 'Qualificado'))
  })

  it('isola tenants e equipes: não move oportunidade alheia nem usa etapa alheia', async () => {
    const opp = await newOpportunity(f.leader)

    await expect(moveOpportunityFor(outsider, opp.id, await stageId(f, 'Qualificado'), {})).rejects.toThrow('Oportunidade não encontrada')
    await expect(moveOpportunityFor(otherAdmin, opp.id, await stageId(other, 'Qualificado'), {})).rejects.toThrow('Oportunidade não encontrada')
    await expect(moveOpportunityFor(f.leader, opp.id, await stageId(other, 'Qualificado'), {})).rejects.toThrow('Etapa não encontrada')
    expect((await reload(opp.id)).stageId).toBe(opp.stageId)
  })

  it('movimentos simultâneos não corrompem o histórico: cada mudança sai de onde a anterior chegou', async () => {
    const opp = await newOpportunity(f.leader)
    const targets = await Promise.all(['Qualificado', 'Proposta', 'Negociação', 'Qualificado', 'Proposta', 'Negociação'].map((name) => stageId(f, name)))

    await Promise.all(targets.map((id) => moveOpportunityFor(f.leader, opp.id, id, {})))

    const changes = await stageChangesOf(opp.id)
    changes.slice(1).forEach((change, i) => expect(change.fromStageId).toBe(changes[i]!.toStageId))
    expect(changes.at(-1)!.toStageId).toBe((await reload(opp.id)).stageId)
  })
})

describe('listPipelineFor', () => {
  let t: Fixture
  let tAdmin: AuthCtx
  let tTeamB: { id: string }
  let tOutsider: AuthCtx

  beforeAll(async () => {
    t = await makeTenant(2)
    tAdmin = await addAdmin(t)
    const [team] = await db.insert(teams).values({ tenantId: t.tenant.id, name: 'B' }).returning()
    tTeamB = team!
    await db.insert(users).values({ id: `tb-${t.tenant.slug}`, name: 'B1', email: `tb-${t.tenant.slug}@test.local`, role: 'TEAM_LEADER', tenantId: t.tenant.id, teamId: team!.id })
    tOutsider = { userId: `tb-${t.tenant.slug}`, tenantId: t.tenant.id, teamId: team!.id, role: 'TEAM_LEADER', name: 'B1', impersonatedBy: null, mustChangePassword: false }

    const [a, b] = [t.members[0]!, t.members[1]!]
    const open = (title: string, amountCents: number, ownerId: string | null) => newOpportunity(t.leader, t, deal({ title, amountCents, ownerId }))
    const o1 = await open('Novo 1', 10_000, a.userId)
    const o2 = await open('Novo 2', 25_050, b.userId)
    const o3 = await open('Proposta 1', 100_000, a.userId)
    await moveOpportunityFor(t.leader, o3.id, await stageId(t, 'Proposta'), {})
    const won = await open('Ganha 1', 70_000, null)
    await moveOpportunityFor(t.leader, won.id, await stageId(t, 'Ganha'), {})
    await moveOpportunityFor(t.leader, o1.id, o1.stageId, { sortOrder: 2 })
    await moveOpportunityFor(t.leader, o2.id, o2.stageId, { sortOrder: 1 })
    await createOpportunityFor(tAdmin, (await newLead(t, { teamId: tTeamB.id })).id, deal({ title: 'Da equipe B', amountCents: 5_000 }))
  })
  afterAll(() => t.cleanup())

  const column = (cols: Awaited<ReturnType<typeof listPipelineFor>>, name: string) => cols.find((c) => c.name === name)!

  it('totaliza por etapa: contagem, soma e ponderado pela probabilidade, calculados à mão', async () => {
    const cols = await listPipelineFor(tAdmin)

    expect(cols.map((c) => c.name)).toEqual(['Novo', 'Qualificado', 'Proposta', 'Negociação', 'Ganha', 'Perdida'])
    expect(column(cols, 'Novo')).toMatchObject({ count: 3, amountCents: 40_050, weightedCents: 4_005 })
    expect(column(cols, 'Proposta')).toMatchObject({ count: 1, amountCents: 100_000, weightedCents: 50_000 })
    expect(column(cols, 'Ganha')).toMatchObject({ count: 1, amountCents: 70_000, weightedCents: 70_000 })
    expect(column(cols, 'Qualificado')).toMatchObject({ count: 0, amountCents: 0, weightedCents: 0 })
  })

  it('ordena os cartões da coluna pela posição', async () => {
    const cols = await listPipelineFor(t.leader)

    expect(column(cols, 'Novo').opportunities.map((o) => o.title)).toEqual(['Novo 2', 'Novo 1'])
  })

  it('o líder vê só a própria equipe, e pedir outra equipe devolve vazio', async () => {
    const own = await listPipelineFor(t.leader)
    const asked = await listPipelineFor(t.leader, { teamId: tTeamB.id })

    expect(own.flatMap((c) => c.opportunities).map((o) => o.title)).not.toContain('Da equipe B')
    expect(asked.flatMap((c) => c.opportunities)).toEqual([])
    expect(column(own, 'Novo').count).toBe(2)
  })

  it('o gestor geral filtra por equipe e por dono', async () => {
    const teamBOnly = await listPipelineFor(tAdmin, { teamId: tTeamB.id })
    const ofA = await listPipelineFor(tAdmin, { ownerId: t.members[0]!.userId })

    expect(teamBOnly.flatMap((c) => c.opportunities).map((o) => o.title)).toEqual(['Da equipe B'])
    expect(ofA.flatMap((c) => c.opportunities).map((o) => o.title).sort()).toEqual(['Novo 1', 'Proposta 1'])
  })

  it('quem é de outra equipe só vê a sua e outro tenant não vê nada', async () => {
    expect((await listPipelineFor(tOutsider)).flatMap((c) => c.opportunities).map((o) => o.title)).toEqual(['Da equipe B'])
    expect((await listPipelineFor(otherAdmin)).flatMap((c) => c.opportunities).every((o) => o.title !== 'Novo 1')).toBe(true)
    expect((await listPipelineFor(otherAdmin)).every((c) => c.tenantId === other.tenant.id)).toBe(true)
  })

  it('quem não tem equipe não vê nenhuma oportunidade', async () => {
    const teamless = await addUser(t, { role: 'MEMBER', team: null })

    expect((await listPipelineFor(teamless)).flatMap((c) => c.opportunities)).toEqual([])
  })

  it('o cartão diz se o usuário pode mexer nele', async () => {
    const asMember = await listPipelineFor(t.members[1]!)

    const byTitle = Object.fromEntries(asMember.flatMap((c) => c.opportunities).map((o) => [o.title, o.canWrite]))
    expect(byTitle['Novo 2']).toBe(true)
    expect(byTitle['Novo 1']).toBe(false)
  })
})

describe('funnelFor', () => {
  let t: Fixture
  let tAdmin: AuthCtx
  let teamBLeader: AuthCtx
  let teamBId: string
  let period: { from: Date; to: Date }

  const reachBy = async (opp: { id: string }, names: Array<string>, at = new Date()) => {
    for (const name of names) {
      const stage = await stageId(t, name)
      await moveOpportunityFor(tAdmin, opp.id, stage, name === 'Perdida' ? { lostReason: 'Sem verba' } : {}, at)
    }
  }

  beforeAll(async () => {
    t = await makeTenant(0)
    tAdmin = await addAdmin(t)
    const now = Date.now()
    period = { from: new Date(now - 30 * DAY_MS), to: new Date(now + DAY_MS) }
    const make = async (title: string, createdAt = new Date()) => createOpportunityFor(tAdmin, (await newLead(t)).id, deal({ title }), createdAt)

    const a = await make('Alfa', new Date(now - 12 * DAY_MS))
    await reachBy(a, ['Qualificado', 'Proposta', 'Ganha'], new Date(now - 2 * DAY_MS))
    const b = await make('Beta')
    await reachBy(b, ['Qualificado', 'Perdida'])
    const c = await make('Gama')
    await reachBy(c, ['Perdida'])
    await make('Delta')
    const e = await make('Épsilon')
    await reachBy(e, ['Proposta'])
    await make('Antiga', new Date(now - 60 * DAY_MS))

    const [team] = await db.insert(teams).values({ tenantId: t.tenant.id, name: 'B' }).returning()
    teamBId = team!.id
    const leaderId = `fb-${t.tenant.slug}`
    await db.insert(users).values({ id: leaderId, name: 'LB', email: `${leaderId}@test.local`, role: 'TEAM_LEADER', tenantId: t.tenant.id, teamId: teamBId })
    teamBLeader = { userId: leaderId, tenantId: t.tenant.id, teamId: teamBId, role: 'TEAM_LEADER', name: 'LB', impersonatedBy: null, mustChangePassword: false }
    await createOpportunityFor(tAdmin, (await newLead(t, { teamId: teamBId })).id, deal({ title: 'Outra equipe' }))
  })
  afterAll(() => t.cleanup())

  it('conversão entre etapas abertas conta oportunidades distintas e trata o pulo de etapa, à mão', async () => {
    const funnel = await funnelFor(tAdmin, period)

    expect(funnel.created).toBe(6)
    expect(funnel.conversion.map((s) => [s.name, s.reached, s.rateFromPrevious])).toEqual([
      ['Novo', 6, null],
      ['Qualificado', 3, 3 / 6],
      ['Proposta', 2, 2 / 3],
      ['Negociação', 1, 1 / 2],
    ])
  })

  it('taxa de ganho e ciclo médio vêm das oportunidades fechadas no período', async () => {
    const funnel = await funnelFor(tAdmin, period)

    expect(funnel).toMatchObject({ won: 1, lost: 2, winRate: 1 / 3 })
    expect(funnel.averageCycleDays).toBeCloseTo(10, 5)
  })

  it('o período recorta a coorte e os fechamentos', async () => {
    const recent = await funnelFor(tAdmin, { from: new Date(Date.now() - DAY_MS), to: new Date(Date.now() + DAY_MS) })

    expect(recent.created).toBe(5)
    expect(recent).toMatchObject({ won: 0, lost: 2 })
    expect(recent.averageCycleDays).toBeNull()
  })

  it('sem oportunidades tudo é zero ou nulo, sem dividir por zero', async () => {
    const funnel = await funnelFor(otherAdmin, period)

    expect(funnel).toMatchObject({ created: 0, won: 0, lost: 0, winRate: null, averageCycleDays: null })
    expect(funnel.conversion.every((s) => s.reached === 0 && s.rateFromPrevious === null)).toBe(true)
  })

  it('o líder só enxerga o funil da própria equipe, e pedir outra equipe devolve vazio', async () => {
    expect((await funnelFor(t.leader, period)).created).toBe(5)
    expect((await funnelFor(teamBLeader, period)).created).toBe(1)
    expect((await funnelFor(teamBLeader, { ...period, teamId: t.team.id })).created).toBe(0)
  })

  it('filtra por equipe para o gestor geral', async () => {
    expect((await funnelFor(tAdmin, { ...period, teamId: teamBId })).created).toBe(1)
    expect((await funnelFor(tAdmin, { ...period, teamId: t.team.id })).created).toBe(5)
  })

})

describe('getOpportunityFor', () => {
  it('traz lead, dono, etapa, histórico com nomes e follow-ups ligados à oportunidade', async () => {
    const opp = await newOpportunity(f.leader, f, deal({ ownerId: f.members[0]!.userId }))
    await moveOpportunityFor(f.leader, opp.id, await stageId(f, 'Qualificado'), {})
    const task = await createTaskFor(f.leader, { title: 'Ligar para a Maria', basePoints: 10, estimatedMinutes: 15, teamId: f.team.id, assignedToId: f.members[0]!.userId, opportunityId: opp.id })

    const detail = await getOpportunityFor(f.members[1]!, opp.id)

    expect(detail.opportunity).toMatchObject({ id: opp.id, title: 'Contrato anual', leadName: 'Maria Souza', ownerName: 'User 1', teamName: 'Time', stageName: 'Qualificado' })
    expect(detail.history.map((h) => [h.fromStageName, h.toStageName])).toEqual([[null, 'Novo'], ['Novo', 'Qualificado']])
    expect(detail.followUps).toMatchObject([{ id: task.id, title: 'Ligar para a Maria', assigneeName: 'User 1', status: 'pending' }])
    expect(detail.stages.map((s) => s.name)).toContain('Perdida')
  })

  it('informa o que o usuário pode fazer', async () => {
    const opp = await newOpportunity(f.leader, f, deal({ ownerId: f.members[0]!.userId }))

    const asOwner = await getOpportunityFor(f.members[0]!, opp.id)
    const asTeammate = await getOpportunityFor(f.members[1]!, opp.id)
    const asLeader = await getOpportunityFor(f.leader, opp.id)

    expect([asOwner.canWrite, asOwner.canReopen]).toEqual([true, false])
    expect([asTeammate.canWrite, asTeammate.canReopen]).toEqual([false, false])
    expect([asLeader.canWrite, asLeader.canReopen]).toEqual([true, true])
  })

  it('não mostra oportunidade de outra equipe nem de outro tenant', async () => {
    const opp = await newOpportunity(f.leader)

    await expect(getOpportunityFor(outsider, opp.id)).rejects.toThrow('Oportunidade não encontrada')
    await expect(getOpportunityFor(otherAdmin, opp.id)).rejects.toThrow('Oportunidade não encontrada')
  })
})

describe('pipelineFiltersFor', () => {
  let t: Fixture
  let tAdmin: AuthCtx
  let tTeamB: { id: string }
  let inB: AuthCtx

  beforeAll(async () => {
    t = await makeTenant(2)
    tAdmin = await addAdmin(t)
    tTeamB = await addTeam(t, 'B')
    inB = await addUser(t, { role: 'MEMBER', team: tTeamB })
  })
  afterAll(() => t.cleanup())

  const ids = (people: Array<AuthCtx>) => people.map((p) => p.userId).sort()
  const ownerIds = async (me: AuthCtx, teamId?: string) => (await pipelineFiltersFor(me, teamId)).owners.map((o) => o.id).sort()

  it('o admin oferece as equipes e os donos do tenant, filtráveis por equipe', async () => {
    const filters = await pipelineFiltersFor(tAdmin)

    expect(filters.teams.map((team) => team.id)).toEqual(expect.arrayContaining([t.team.id, tTeamB.id]))
    expect(await ownerIds(tAdmin)).toEqual(ids([t.leader, ...t.members, tAdmin, inB]))
    expect(await ownerIds(tAdmin, tTeamB.id)).toEqual(ids([inB]))
  })

  it('quem não é admin só vê os donos da própria equipe, sem lista de equipes e ignorando o filtro de equipe', async () => {
    const member = t.members[0]!
    const ownTeam = ids([t.leader, ...t.members, tAdmin])

    expect((await pipelineFiltersFor(member)).teams).toEqual([])
    expect(await ownerIds(member)).toEqual(ownTeam)
    expect(await ownerIds(member, tTeamB.id)).toEqual(ownTeam)
  })

  it('quem não tem equipe não vê dono nenhum', async () => {
    const teamless = await addUser(t, { role: 'MEMBER', team: null })

    expect(await ownerIds(teamless)).toEqual([])
  })
})
