import { and, asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { auditEvents, leads, opportunities, pipelineStages, pipelines, teamMembers, teamPipelines } from '#/db/schema'
import { createOpportunityFor, moveOpportunityFor } from './pipeline.core'
import { setCapabilityFor } from './permissions.core'
import { archivePipelineFor, createPipelineFor, linkTeamToPipelineFor, listPipelinesFor, renamePipelineFor, restorePipelineFor, unlinkTeamFromPipelineFor } from './pipelines.core'
import type { AuthCtx } from './roles'
import { listStagesFor } from './stages.core'
import { addLead, addOpportunity } from './test-crm-fixtures'
import { addAdmin, addTeam, addUser, ctxFor, makeTenant } from './test-fixtures'

type Fixture = Awaited<ReturnType<typeof makeTenant>>

let f: Fixture
let other: Fixture
let admin: AuthCtx
let otherAdmin: AuthCtx
let teamB: { id: string }

const deal = { title: 'Contrato', amountCents: 10_000 }

async function openDealIn(pipelineId: string, teamId = f.team.id) {
  const [lead] = await db.insert(leads).values({ tenantId: f.tenant.id, teamId, name: 'Lead' }).returning()
  return createOpportunityFor(admin, lead!.id, { ...deal, pipelineId })
}

async function closeDeal(opportunityId: string, pipelineId: string) {
  const lost = (await listStagesFor(admin, pipelineId)).find((s) => s.kind === 'lost')!
  await moveOpportunityFor(admin, opportunityId, lost.id, { lostReason: 'Sem orçamento' })
}

const auditFor = (entityId: string) =>
  db.select().from(auditEvents).where(and(eq(auditEvents.tenantId, f.tenant.id), eq(auditEvents.entityId, entityId))).orderBy(asc(auditEvents.createdAt), asc(auditEvents.id))

const actionsFor = async (entityId: string) => (await auditFor(entityId)).map((e) => e.action)

const reload = async (id: string) => (await db.select().from(pipelines).where(eq(pipelines.id, id)))[0]!

const linksOf = (pipelineId: string) => db.select().from(teamPipelines).where(eq(teamPipelines.pipelineId, pipelineId))

let sequence = 0
const uniqueName = (label: string) => `${label} ${++sequence}`

beforeAll(async () => {
  f = await makeTenant(2)
  other = await makeTenant(0)
  admin = await addAdmin(f)
  otherAdmin = await addAdmin(other)
  teamB = await addTeam(f, 'Equipe B')
})
afterAll(async () => {
  await f.cleanup()
  await other.cleanup()
  await db.$client.end()
})

describe('createPipelineFor', () => {
  it('cria já com as etapas padrão, fora do padrão do tenant, e audita', async () => {
    const created = await createPipelineFor(admin, '  Parcerias  ')

    expect(created).toMatchObject({ name: 'Parcerias', isDefault: false, archivedAt: null, tenantId: f.tenant.id })
    const stages = await listStagesFor(admin, created.id)
    expect(stages.map((s) => s.name)).toEqual(['Novo', 'Qualificado', 'Proposta', 'Negociação', 'Ganha', 'Perdida'])
    expect(await actionsFor(created.id)).toEqual(['pipeline.created'])
  })

  it('só quem tem pipeline.configure cria', async () => {
    await expect(createPipelineFor(f.leader, uniqueName('Líder'))).rejects.toThrow('Sem permissão')
    await expect(createPipelineFor(f.members[0]!, uniqueName('Membro'))).rejects.toThrow('Sem permissão')
  })

  it('recusa nome curto ou longo demais', async () => {
    await expect(createPipelineFor(admin, ' a ')).rejects.toThrow('nome')
    await expect(createPipelineFor(admin, 'x'.repeat(81))).rejects.toThrow('nome')
  })

  it('recusa nome repetido sem diferenciar maiúsculas, mas aceita o mesmo nome em outro tenant', async () => {
    const name = uniqueName('Canal')
    await createPipelineFor(admin, name)

    await expect(createPipelineFor(admin, `  ${name.toUpperCase()} `)).rejects.toThrow('Já existe um pipeline com esse nome')
    await expect(createPipelineFor(otherAdmin, name)).resolves.toMatchObject({ name })
  })

  it('dois pedidos simultâneos com o mesmo nome: um vence, o outro recebe a mensagem e não sobra pipeline sem etapas', async () => {
    const name = uniqueName('Disputa')

    const results = await Promise.allSettled([createPipelineFor(admin, name), createPipelineFor(admin, name)])

    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(String(rejected[0]!.reason)).toContain('Já existe um pipeline com esse nome')
    const rows = await db.select().from(pipelines).where(and(eq(pipelines.tenantId, f.tenant.id), eq(pipelines.name, name)))
    expect(rows).toHaveLength(1)
    expect(await listStagesFor(admin, rows[0]!.id)).toHaveLength(6)
  })
})

describe('renamePipelineFor', () => {
  it('renomeia com trim e registra o diff', async () => {
    const created = await createPipelineFor(admin, uniqueName('Antigo'))

    const renamed = await renamePipelineFor(admin, created.id, '  Novo nome ')

    expect(renamed.name).toBe('Novo nome')
    const [, event] = await auditFor(created.id)
    expect(event).toMatchObject({ action: 'pipeline.updated', changes: { name: { from: created.name, to: 'Novo nome' } } })
  })

  it('não grava evento quando o nome não muda', async () => {
    const created = await createPipelineFor(admin, uniqueName('Igual'))

    await renamePipelineFor(admin, created.id, ` ${created.name} `)

    expect(await actionsFor(created.id)).toEqual(['pipeline.created'])
  })

  it('recusa nome de outro pipeline ativo, mas libera o nome de um arquivado', async () => {
    const taken = await createPipelineFor(admin, uniqueName('Ocupado'))
    const archived = await createPipelineFor(admin, uniqueName('Arquivado'))
    await archivePipelineFor(admin, archived.id)
    const mine = await createPipelineFor(admin, uniqueName('Meu'))

    await expect(renamePipelineFor(admin, mine.id, taken.name.toUpperCase())).rejects.toThrow('Já existe um pipeline com esse nome')
    await expect(renamePipelineFor(admin, mine.id, archived.name)).resolves.toMatchObject({ name: archived.name })
  })

  it('só admin renomeia e pipeline de outro tenant é "não encontrado"', async () => {
    const created = await createPipelineFor(admin, uniqueName('Protegido'))

    await expect(renamePipelineFor(f.leader, created.id, 'Invadido')).rejects.toThrow('Sem permissão')
    await expect(renamePipelineFor(otherAdmin, created.id, 'Invadido')).rejects.toThrow('Pipeline não encontrado')
    expect((await reload(created.id)).name).toBe(created.name)
  })
})

describe('archivePipelineFor e restorePipelineFor', () => {
  it('arquiva pipeline sem trabalho aberto e audita', async () => {
    const created = await createPipelineFor(admin, uniqueName('Velho'))

    await archivePipelineFor(admin, created.id)

    expect((await reload(created.id)).archivedAt).toBeInstanceOf(Date)
    expect(await actionsFor(created.id)).toEqual(['pipeline.created', 'pipeline.archived'])
  })

  it('grava como momento do arquivamento o relógio recebido', async () => {
    const created = await createPipelineFor(admin, uniqueName('Com relógio'))
    const now = new Date('2026-03-04T10:00:00Z')

    await archivePipelineFor(admin, created.id, now)

    expect((await reload(created.id)).archivedAt).toEqual(now)
  })

  it('recusa arquivar o pipeline padrão', async () => {
    await expect(archivePipelineFor(admin, f.pipeline.id)).rejects.toThrow('padrão')
    expect((await reload(f.pipeline.id)).archivedAt).toBeNull()
  })

  it('recusa arquivar com oportunidade em etapa aberta, com a contagem na mensagem', async () => {
    const created = await createPipelineFor(admin, uniqueName('Ocupado'))
    await linkTeamToPipelineFor(admin, created.id, f.team.id)
    await openDealIn(created.id)
    await openDealIn(created.id)

    await expect(archivePipelineFor(admin, created.id)).rejects.toThrow('2 oportunidades em etapa aberta')
    expect((await reload(created.id)).archivedAt).toBeNull()
  })

  it('arquiva quando só restam oportunidades fechadas', async () => {
    const created = await createPipelineFor(admin, uniqueName('Só histórico'))
    await linkTeamToPipelineFor(admin, created.id, f.team.id)
    const opp = await openDealIn(created.id)
    await closeDeal(opp.id, created.id)

    await archivePipelineFor(admin, created.id)

    expect((await reload(created.id)).archivedAt).not.toBeNull()
  })

  it('oportunidade fechada de pipeline arquivado não volta para etapa aberta até restaurar', async () => {
    const created = await createPipelineFor(admin, uniqueName('Congelado'))
    await linkTeamToPipelineFor(admin, created.id, f.team.id)
    const opp = await openDealIn(created.id)
    await closeDeal(opp.id, created.id)
    await archivePipelineFor(admin, created.id)
    const firstOpen = (await listStagesFor(admin, created.id)).find((s) => s.kind === 'open')!

    await expect(moveOpportunityFor(admin, opp.id, firstOpen.id)).rejects.toThrow('Pipeline arquivado')
    await restorePipelineFor(admin, created.id)

    await expect(moveOpportunityFor(admin, opp.id, firstOpen.id)).resolves.toMatchObject({ stageId: firstOpen.id })
  })

  it('restaura, mas recusa se outro pipeline ativo já usa o nome', async () => {
    const created = await createPipelineFor(admin, uniqueName('Volta'))
    await archivePipelineFor(admin, created.id)
    const squatter = await createPipelineFor(admin, created.name)

    await expect(restorePipelineFor(admin, created.id)).rejects.toThrow('Já existe um pipeline com esse nome')
    await renamePipelineFor(admin, squatter.id, uniqueName('Outro'))
    await restorePipelineFor(admin, created.id)

    expect((await reload(created.id)).archivedAt).toBeNull()
    expect(await actionsFor(created.id)).toEqual(['pipeline.created', 'pipeline.archived', 'pipeline.restored'])
  })

  it('só admin, e pipeline de outro tenant é "não encontrado"', async () => {
    const created = await createPipelineFor(admin, uniqueName('Resguardado'))

    await expect(archivePipelineFor(f.leader, created.id)).rejects.toThrow('Sem permissão')
    await expect(archivePipelineFor(otherAdmin, created.id)).rejects.toThrow('Pipeline não encontrado')
    await expect(restorePipelineFor(otherAdmin, created.id)).rejects.toThrow('Pipeline não encontrado')
  })

  it('arquivar duas vezes ou restaurar um ativo é recusado, sem evento extra', async () => {
    const created = await createPipelineFor(admin, uniqueName('Duas vezes'))

    await expect(restorePipelineFor(admin, created.id)).rejects.toThrow('não está arquivado')
    await archivePipelineFor(admin, created.id)
    await expect(archivePipelineFor(admin, created.id)).rejects.toThrow('já está arquivado')
    expect(await actionsFor(created.id)).toEqual(['pipeline.created', 'pipeline.archived'])
  })
})

describe('listPipelinesFor', () => {
  let onlyB: { id: string }
  let shared: { id: string }
  let memberB: AuthCtx

  beforeAll(async () => {
    onlyB = await createPipelineFor(admin, uniqueName('Só da equipe B'))
    shared = await createPipelineFor(admin, uniqueName('Compartilhado'))
    await linkTeamToPipelineFor(admin, onlyB.id, teamB.id)
    await linkTeamToPipelineFor(admin, shared.id, teamB.id)
    await linkTeamToPipelineFor(admin, shared.id, f.team.id)
    memberB = await addUser(f, { role: 'MEMBER', team: teamB })
  })

  const idsFor = async (me: AuthCtx) => (await listPipelinesFor(me)).map((p) => p.id)

  it('o admin vê todos os pipelines do tenant, inclusive arquivados, com o padrão primeiro', async () => {
    const archived = await createPipelineFor(admin, uniqueName('Fora de uso'))
    await archivePipelineFor(admin, archived.id)

    const list = await listPipelinesFor(admin)

    expect(list[0]!.id).toBe(f.pipeline.id)
    expect(list.map((p) => p.id)).toEqual(expect.arrayContaining([f.pipeline.id, onlyB.id, shared.id, archived.id]))
    expect(list.every((p) => p.tenantId === f.tenant.id)).toBe(true)
  })

  it('o membro vê só os efetivos da equipe: o vínculo substitui o padrão', async () => {
    const ids = await idsFor(memberB)

    expect(ids).toEqual(expect.arrayContaining([onlyB.id, shared.id]))
    expect(ids).not.toContain(f.pipeline.id)
  })

  it('pessoa em duas equipes vê a união: vínculos de uma e o padrão da que não tem vínculo', async () => {
    const both = await addUser(f, { role: 'MEMBER', team: teamB })
    const loose = await addTeam(f, uniqueName('Sem vínculo'))
    await db.insert(teamMembers).values({ teamId: loose.id, userId: both.userId, tenantId: f.tenant.id })

    const ids = await idsFor(await ctxFor(both.userId))

    expect(ids).toEqual(expect.arrayContaining([onlyB.id, shared.id, f.pipeline.id]))
  })

  it('equipe sem vínculo usa o pipeline padrão, e quem não tem equipe não vê nenhum', async () => {
    const loose = await addTeam(f, uniqueName('Solta'))
    const member = await addUser(f, { role: 'MEMBER', team: loose })
    const teamless = await addUser(f, { role: 'MEMBER', team: null })

    expect(await idsFor(member)).toEqual([f.pipeline.id])
    expect(await idsFor(teamless)).toEqual([])
  })

  it('vínculo só com pipeline arquivado volta para o padrão', async () => {
    const lonely = await addTeam(f, uniqueName('Pipeline arquivado'))
    const gone = await createPipelineFor(admin, uniqueName('Descontinuado'))
    await linkTeamToPipelineFor(admin, gone.id, lonely.id)
    const member = await addUser(f, { role: 'MEMBER', team: lonely })
    expect(await idsFor(member)).toEqual([gone.id])

    await archivePipelineFor(admin, gone.id)

    expect(await idsFor(member)).toEqual([f.pipeline.id])
  })

  it('não mostra pipeline de outro tenant', async () => {
    const theirs = await createPipelineFor(otherAdmin, uniqueName('Deles'))

    expect(await idsFor(admin)).not.toContain(theirs.id)
    expect(await idsFor(memberB)).not.toContain(theirs.id)
  })
})

describe('linkTeamToPipelineFor', () => {
  it('vincula, audita com a equipe no meta e é idempotente', async () => {
    const created = await createPipelineFor(admin, uniqueName('Vinculado'))

    await linkTeamToPipelineFor(admin, created.id, teamB.id)
    await linkTeamToPipelineFor(admin, created.id, teamB.id)

    expect(await linksOf(created.id)).toHaveLength(1)
    const events = (await auditFor(created.id)).filter((e) => e.action === 'pipeline.team_linked')
    expect(events).toHaveLength(1)
    expect(events[0]!.meta).toMatchObject({ teamId: teamB.id })
  })

  it('por padrão só admin vincula; o líder só depois da delegação e só nas equipes dele', async () => {
    const created = await createPipelineFor(admin, uniqueName('Delegado'))
    await expect(linkTeamToPipelineFor(f.leader, created.id, f.team.id)).rejects.toThrow('Sem permissão')
    await setCapabilityFor(admin, 'LEADER', 'team.link', true)
    try {
      const leader = await ctxFor(f.leader.userId)

      await linkTeamToPipelineFor(leader, created.id, f.team.id)
      await expect(linkTeamToPipelineFor(leader, created.id, teamB.id)).rejects.toThrow('Sem permissão')
      await expect(linkTeamToPipelineFor(await ctxFor(f.members[0]!.userId), created.id, f.team.id)).rejects.toThrow('Sem permissão')
    } finally {
      await setCapabilityFor(admin, 'LEADER', 'team.link', false)
    }
  })

  it('recusa pipeline ou equipe de outro tenant', async () => {
    const mine = await createPipelineFor(admin, uniqueName('Meu vínculo'))
    const theirs = await createPipelineFor(otherAdmin, uniqueName('Pipeline deles'))

    await expect(linkTeamToPipelineFor(admin, theirs.id, f.team.id)).rejects.toThrow('Pipeline não encontrado')
    await expect(linkTeamToPipelineFor(admin, mine.id, other.team.id)).rejects.toThrow('Equipe não encontrada')
    await expect(linkTeamToPipelineFor(otherAdmin, mine.id, other.team.id)).rejects.toThrow('Pipeline não encontrado')
  })

  it('recusa vincular a pipeline arquivado', async () => {
    const created = await createPipelineFor(admin, uniqueName('Já arquivado'))
    await archivePipelineFor(admin, created.id)

    await expect(linkTeamToPipelineFor(admin, created.id, teamB.id)).rejects.toThrow('arquivado')
  })

  it('o banco rejeita vínculo entre tenants mesmo por insert direto', async () => {
    const mine = await createPipelineFor(admin, uniqueName('Isolado'))

    await expect(db.insert(teamPipelines).values({ pipelineId: mine.id, teamId: other.team.id, tenantId: f.tenant.id })).rejects.toThrow()
    await expect(db.insert(teamPipelines).values({ pipelineId: mine.id, teamId: other.team.id, tenantId: other.tenant.id })).rejects.toThrow()
    expect(await linksOf(mine.id)).toHaveLength(0)
  })
})

describe('unlinkTeamFromPipelineFor', () => {
  it('desvincula e audita', async () => {
    const created = await createPipelineFor(admin, uniqueName('Desvinculável'))
    await linkTeamToPipelineFor(admin, created.id, teamB.id)

    await unlinkTeamFromPipelineFor(admin, created.id, teamB.id)

    expect(await linksOf(created.id)).toHaveLength(0)
    expect(await actionsFor(created.id)).toEqual(['pipeline.created', 'pipeline.team_linked', 'pipeline.team_unlinked'])
  })

  it('desvincular quem não está vinculado não faz nada', async () => {
    const created = await createPipelineFor(admin, uniqueName('Nunca vinculado'))

    await unlinkTeamFromPipelineFor(admin, created.id, teamB.id)

    expect(await actionsFor(created.id)).toEqual(['pipeline.created'])
  })

  it('recusa com oportunidade da equipe em etapa aberta, com a contagem, e mantém o vínculo', async () => {
    const created = await createPipelineFor(admin, uniqueName('Trabalho vivo'))
    await linkTeamToPipelineFor(admin, created.id, f.team.id)
    await openDealIn(created.id)

    await expect(unlinkTeamFromPipelineFor(admin, created.id, f.team.id)).rejects.toThrow('1 oportunidade em etapa aberta')
    expect(await linksOf(created.id)).toHaveLength(1)
  })

  it('permite quando só resta histórico fechado, e as oportunidades continuam no pipeline', async () => {
    const created = await createPipelineFor(admin, uniqueName('Histórico fechado'))
    await linkTeamToPipelineFor(admin, created.id, f.team.id)
    const opp = await openDealIn(created.id)
    await closeDeal(opp.id, created.id)

    await unlinkTeamFromPipelineFor(admin, created.id, f.team.id)

    const [kept] = await db.select().from(opportunities).where(eq(opportunities.id, opp.id))
    expect(kept!.pipelineId).toBe(created.id)
  })

  it('o trabalho aberto de outra equipe não impede desvincular', async () => {
    const created = await createPipelineFor(admin, uniqueName('Duas equipes'))
    await linkTeamToPipelineFor(admin, created.id, f.team.id)
    await linkTeamToPipelineFor(admin, created.id, teamB.id)
    await openDealIn(created.id, f.team.id)

    await unlinkTeamFromPipelineFor(admin, created.id, teamB.id)

    expect(await linksOf(created.id)).toHaveLength(1)
  })

  it('exige team.link', async () => {
    const created = await createPipelineFor(admin, uniqueName('Sem permissão'))
    await linkTeamToPipelineFor(admin, created.id, f.team.id)

    await expect(unlinkTeamFromPipelineFor(f.leader, created.id, f.team.id)).rejects.toThrow('Sem permissão')
  })
})

describe('o pipeline padrão deixa de valer quando a equipe ganha o primeiro vínculo', () => {
  async function teamWithOpenDealInDefault(label: string) {
    const team = await addTeam(f, uniqueName(label))
    const opp = await openDealIn(f.pipeline.id, team.id)
    return { team, opp }
  }

  it('recusa o primeiro vínculo enquanto a equipe tem oportunidade aberta no padrão, com a contagem, e não vincula', async () => {
    const { team } = await teamWithOpenDealInDefault('Usa o padrão')
    await openDealIn(f.pipeline.id, team.id)
    const created = await createPipelineFor(admin, uniqueName('Novo destino'))

    await expect(linkTeamToPipelineFor(admin, created.id, team.id)).rejects.toThrow('2 oportunidades em etapa aberta')
    expect(await linksOf(created.id)).toHaveLength(0)
  })

  it('permite o primeiro vínculo quando no padrão só resta histórico fechado', async () => {
    const { team, opp } = await teamWithOpenDealInDefault('Só histórico')
    await closeDeal(opp.id, f.pipeline.id)
    const created = await createPipelineFor(admin, uniqueName('Destino livre'))

    await linkTeamToPipelineFor(admin, created.id, team.id)

    expect(await linksOf(created.id)).toHaveLength(1)
  })

  it('o trabalho aberto de outra equipe no padrão não impede o vínculo', async () => {
    await teamWithOpenDealInDefault('Vizinha')
    const team = await addTeam(f, uniqueName('Sem trabalho'))
    const created = await createPipelineFor(admin, uniqueName('Destino da outra'))

    await linkTeamToPipelineFor(admin, created.id, team.id)

    expect(await linksOf(created.id)).toHaveLength(1)
  })

  it('o segundo vínculo ativo não olha o padrão, que já não valia para a equipe', async () => {
    const team = await addTeam(f, uniqueName('Já vinculada'))
    const [first, second] = [await createPipelineFor(admin, uniqueName('Primeiro')), await createPipelineFor(admin, uniqueName('Segundo'))]
    await linkTeamToPipelineFor(admin, first.id, team.id)
    await addOpportunity(f, await addLead(f, team.id), null)

    await linkTeamToPipelineFor(admin, second.id, team.id)

    expect(await linksOf(second.id)).toHaveLength(1)
  })

  it('vincular a equipe ao próprio padrão não tira nada de vigor e é permitido com trabalho aberto', async () => {
    const { team } = await teamWithOpenDealInDefault('Fixa o padrão')

    await linkTeamToPipelineFor(admin, f.pipeline.id, team.id)

    expect(await linksOf(f.pipeline.id)).toEqual(expect.arrayContaining([expect.objectContaining({ teamId: team.id })]))
  })

  it('restaurar pipeline cujo único vínculo da equipe estava arquivado é recusado enquanto ela tem trabalho aberto no padrão', async () => {
    const team = await addTeam(f, uniqueName('Volta ao vínculo'))
    const created = await createPipelineFor(admin, uniqueName('Arquivado e restaurável'))
    await linkTeamToPipelineFor(admin, created.id, team.id)
    await archivePipelineFor(admin, created.id)
    const opp = await openDealIn(f.pipeline.id, team.id)

    await expect(restorePipelineFor(admin, created.id)).rejects.toThrow('1 oportunidade em etapa aberta')
    expect((await reload(created.id)).archivedAt).not.toBeNull()

    await closeDeal(opp.id, f.pipeline.id)
    await restorePipelineFor(admin, created.id)
    expect((await reload(created.id)).archivedAt).toBeNull()
  })
})

describe('concorrência', () => {
  const rounds = 6

  async function linkedPipeline(label: string) {
    const created = await createPipelineFor(admin, uniqueName(label))
    await linkTeamToPipelineFor(admin, created.id, f.team.id)
    return created
  }

  it('arquivar × criar oportunidade no mesmo pipeline: nunca sobra oportunidade aberta em pipeline arquivado', async () => {
    for (let round = 0; round < rounds; round++) {
      const created = await linkedPipeline('Corrida de arquivo')

      const results = await Promise.allSettled([archivePipelineFor(admin, created.id), openDealIn(created.id)])

      const archived = (await reload(created.id)).archivedAt !== null
      const [open] = await db
        .select({ id: opportunities.id })
        .from(opportunities)
        .innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId))
        .where(and(eq(opportunities.pipelineId, created.id), eq(pipelineStages.kind, 'open')))
      expect(archived && open !== undefined).toBe(false)
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    }
  })

  it('arquivar × reabrir oportunidade fechada: nunca sobra oportunidade aberta em pipeline arquivado', async () => {
    for (let round = 0; round < rounds; round++) {
      const created = await linkedPipeline('Corrida de reabertura')
      const opp = await openDealIn(created.id)
      await closeDeal(opp.id, created.id)
      const first = (await listStagesFor(admin, created.id)).find((s) => s.kind === 'open')!

      const results = await Promise.allSettled([archivePipelineFor(admin, created.id), moveOpportunityFor(admin, opp.id, first.id)])

      const archived = (await reload(created.id)).archivedAt !== null
      const [current] = await db.select().from(opportunities).where(eq(opportunities.id, opp.id))
      expect(archived && current!.stageId === first.id).toBe(false)
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    }
  })

  it('vínculo confirmado enquanto a criação espera o padrão: a criação é recusada e nada fica aberto no padrão', async () => {
    const team = await addTeam(f, uniqueName('Corrida do padrão'))
    const created = await createPipelineFor(admin, uniqueName('Destino da corrida'))
    const lead = await addLead(f, team.id)
    let locked!: () => void
    let release!: () => void
    const defaultLocked = new Promise<void>((resolve) => (locked = resolve))
    const released = new Promise<void>((resolve) => (release = resolve))
    const linking = db.transaction(async (tx) => {
      await tx.select().from(pipelines).where(eq(pipelines.id, f.pipeline.id)).for('update')
      locked()
      await released
      await tx.insert(teamPipelines).values({ pipelineId: created.id, teamId: team.id, tenantId: f.tenant.id })
    })
    await defaultLocked

    const creating = createOpportunityFor(admin, lead.id, deal).then(() => 'criada', (error: unknown) => String(error))
    await new Promise((resolve) => setTimeout(resolve, 200))
    release()
    await linking

    expect(await creating).toContain('não está vinculado')
    expect(await db.select({ id: opportunities.id }).from(opportunities).where(eq(opportunities.teamId, team.id))).toHaveLength(0)
  })

  it('desvincular × criar oportunidade: nunca fica trabalho aberto em pipeline desvinculado', async () => {
    for (let round = 0; round < rounds; round++) {
      const created = await linkedPipeline('Corrida de vínculo')

      const results = await Promise.allSettled([unlinkTeamFromPipelineFor(admin, created.id, f.team.id), openDealIn(created.id)])

      const stillLinked = (await linksOf(created.id)).length > 0
      const [anyDeal] = await db.select({ id: opportunities.id }).from(opportunities).where(eq(opportunities.pipelineId, created.id))
      expect(!stillLinked && anyDeal !== undefined).toBe(false)
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    }
  })
})
