import { and, asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { auditEvents, leads, notes, opportunities, pipelineStages, teams } from '#/db/schema'
import { assignLeadFor, claimLeadFor, createLeadFor, deleteLeadFor, getLeadFor, leadOptionsFor, leastLoadedOwner, listLeadsFor, updateLeadFor } from './leads.core'
import { addNoteFor } from './notes.core'
import type { AuthCtx } from './roles'
import { addAdmin, addTeam, addUser, joinTeam, makeTenant } from './test-fixtures'

let f: Awaited<ReturnType<typeof makeTenant>>
let other: Awaited<ReturnType<typeof makeTenant>>
let admin: AuthCtx
let otherTeamId: string
let outsider: AuthCtx
let otherTenantAdmin: AuthCtx

const [ana, bruno] = [() => f.members[0]!, () => f.members[1]!]

async function seedLead(patch: Partial<typeof leads.$inferInsert> = {}) {
  const [lead] = await db.insert(leads).values({ tenantId: f.tenant.id, teamId: f.team.id, name: 'Lead', ...patch }).returning()
  return lead!
}

async function seedOpportunity(lead: { id: string; tenantId: string; teamId: string }, ownerId: string | null, kind: 'open' | 'won' = 'open') {
  const [stage] = await db
    .select()
    .from(pipelineStages)
    .where(and(eq(pipelineStages.tenantId, lead.tenantId), eq(pipelineStages.kind, kind)))
    .orderBy(asc(pipelineStages.sortOrder))
    .limit(1)
  const [opp] = await db
    .insert(opportunities)
    .values({ tenantId: lead.tenantId, teamId: lead.teamId, leadId: lead.id, ownerId, title: 'Negócio', stageId: stage!.id })
    .returning()
  return opp!
}

const eventsOf = (entityId: string) =>
  db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.tenantId, f.tenant.id), eq(auditEvents.entityId, entityId)))
    .orderBy(asc(auditEvents.createdAt))

const unique = () => Math.random().toString(36).slice(2, 10)

beforeAll(async () => {
  f = await makeTenant(2)
  other = await makeTenant(1)
  admin = await addAdmin(f)
  otherTenantAdmin = await addAdmin(other)
  const [team2] = await db.insert(teams).values({ tenantId: f.tenant.id, name: 'Outra equipe' }).returning()
  otherTeamId = team2!.id
  outsider = await addUser(f, { role: 'MEMBER', team: team2! })
})
afterAll(async () => {
  await f.cleanup()
  await other.cleanup()
  await db.$client.end()
})

describe('criar lead', () => {
  it('grava e-mail e telefone normalizados e audita a criação', async () => {
    const r = await createLeadFor(ana(), { name: 'Carla', email: ' Carla@Acme.COM ', phone: '(11) 98765-4321', source: 'site', teamId: f.team.id, ownerId: ana().userId })

    expect(r.created && r.lead).toMatchObject({ name: 'Carla', emailNormalized: 'carla@acme.com', phoneDigits: '11987654321', ownerId: ana().userId, createdById: ana().userId, status: 'new' })
    const [e] = await eventsOf(r.created ? r.lead.id : '')
    expect(e).toMatchObject({ action: 'lead.created', entityType: 'lead', actorId: ana().userId })
  })

  it('sem dono informado, o lead vai para o pool', async () => {
    const r = await createLeadFor(ana(), { name: 'Pool', teamId: f.team.id })

    expect(r.created && r.lead.ownerId).toBeNull()
  })

  it('avisa duplicado por e-mail em vez de criar', async () => {
    const existing = await seedLead({ email: 'dup@acme.com', emailNormalized: 'dup@acme.com' })

    const r = await createLeadFor(ana(), { name: 'Outro nome', email: 'DUP@acme.com', teamId: f.team.id })

    expect(r.created).toBe(false)
    expect(!r.created && r.duplicates.map((d) => d.id)).toEqual([existing.id])
  })

  it('avisa duplicado por telefone, ignorando a formatação', async () => {
    const existing = await seedLead({ phone: '11 91111-2222', phoneDigits: '11911112222' })

    const r = await createLeadFor(ana(), { name: 'Outro', phone: '(11) 9 1111-2222', teamId: f.team.id })

    expect(!r.created && r.duplicates.map((d) => d.id)).toEqual([existing.id])
  })

  it('com force cria mesmo havendo duplicado', async () => {
    await seedLead({ email: 'force@acme.com', emailNormalized: 'force@acme.com' })

    const r = await createLeadFor(ana(), { name: 'Repetido', email: 'force@acme.com', teamId: f.team.id }, { force: true })

    expect(r.created).toBe(true)
  })

  it('duplicado de outra equipe é apontado, mas sem expor os dados; de outro tenant nem aparece', async () => {
    const hidden = await seedLead({ teamId: otherTeamId, name: 'Segredo S/A', company: 'Segredo', email: 'tenant-wide@acme.com', emailNormalized: 'tenant-wide@acme.com' })
    await db.insert(leads).values({ tenantId: other.tenant.id, teamId: other.team.id, name: 'Alheio', email: 'tenant-wide@acme.com', emailNormalized: 'tenant-wide@acme.com' })

    const r = await createLeadFor(ana(), { name: 'Novo', email: 'tenant-wide@acme.com', teamId: f.team.id })

    expect(!r.created && r.duplicates).toEqual([{ id: hidden.id, visible: false, name: 'Lead de outra equipe', company: null, email: null, phone: null }])
  })

  it('o duplicado visível vem com os dados', async () => {
    const visible = await seedLead({ name: 'Visível', company: 'Acme', email: 'visible@acme.com', emailNormalized: 'visible@acme.com' })

    const r = await createLeadFor(ana(), { name: 'Novo', email: 'visible@acme.com', teamId: f.team.id })

    expect(!r.created && r.duplicates).toEqual([{ id: visible.id, visible: true, name: 'Visível', company: 'Acme', email: 'visible@acme.com', phone: null }])
  })

  it('membro não cria lead em outra equipe; admin cria em qualquer uma', async () => {
    await expect(createLeadFor(ana(), { name: 'X', teamId: otherTeamId })).rejects.toThrow('Sem permissão')

    const r = await createLeadFor(admin, { name: 'X', teamId: otherTeamId })

    expect(r.created && r.lead.teamId).toBe(otherTeamId)
  })

  it('recusa equipe de outro tenant', async () => {
    await expect(createLeadFor(admin, { name: 'X', teamId: other.team.id })).rejects.toThrow('Equipe não encontrada')
  })

  it('o dono tem de ser da mesma equipe; membro só pode ser dono de si mesmo', async () => {
    await expect(createLeadFor(f.leader, { name: 'X', teamId: f.team.id, ownerId: outsider.userId })).rejects.toThrow('Responsável não pertence à equipe')
    await expect(createLeadFor(ana(), { name: 'X', teamId: f.team.id, ownerId: bruno().userId })).rejects.toThrow('Sem permissão')

    const r = await createLeadFor(f.leader, { name: 'X', teamId: f.team.id, ownerId: bruno().userId })

    expect(r.created && r.lead.ownerId).toBe(bruno().userId)
  })

  it('recusa dados inválidos com a mensagem do campo', async () => {
    await expect(createLeadFor(ana(), { name: 'X', email: 'sem-arroba', teamId: f.team.id })).rejects.toThrow('E-mail inválido')
    await expect(createLeadFor(ana(), { name: '  ', teamId: f.team.id })).rejects.toThrow('Informe o nome')
  })
})

describe('editar lead', () => {
  const edit = (patch: Partial<Parameters<typeof updateLeadFor>[2]> = {}) => ({ name: 'Lead', status: 'new' as const, source: 'outro' as const, ...patch })

  it('atualiza os campos, renormaliza e audita só o que mudou', async () => {
    const lead = await seedLead({ ownerId: ana().userId, name: 'Antes', email: 'a@acme.com', emailNormalized: 'a@acme.com' })

    await updateLeadFor(ana(), lead.id, edit({ name: 'Depois', email: 'B@Acme.com', status: 'contacted', source: 'evento' }))

    const [row] = await db.select().from(leads).where(eq(leads.id, lead.id))
    expect(row).toMatchObject({ name: 'Depois', email: 'B@Acme.com', emailNormalized: 'b@acme.com', status: 'contacted', source: 'evento' })
    const [e] = await eventsOf(lead.id)
    expect(e).toMatchObject({
      action: 'lead.updated',
      changes: {
        name: { from: 'Antes', to: 'Depois' },
        email: { from: 'a@acme.com', to: 'B@Acme.com' },
        status: { from: 'new', to: 'contacted' },
        source: { from: 'outro', to: 'evento' },
      },
    })
    expect(Object.keys(e!.changes ?? {}).sort()).toEqual(['email', 'name', 'source', 'status'])
  })

  it('sem mudança, não gera evento', async () => {
    const lead = await seedLead({ ownerId: ana().userId })

    await updateLeadFor(ana(), lead.id, edit())

    expect(await eventsOf(lead.id)).toHaveLength(0)
  })

  it('só o dono ou um gestor edita; quem não vê o lead nem o encontra', async () => {
    const lead = await seedLead({ ownerId: ana().userId })

    await expect(updateLeadFor(bruno(), lead.id, edit())).rejects.toThrow('Sem permissão')
    await expect(updateLeadFor(outsider, lead.id, edit())).rejects.toThrow('Lead não encontrado')
    await expect(updateLeadFor(otherTenantAdmin, lead.id, edit())).rejects.toThrow('Lead não encontrado')
    await updateLeadFor(f.leader, lead.id, edit({ name: 'Pelo líder' }))
    await updateLeadFor(admin, lead.id, edit({ name: 'Pelo admin' }))
  })

  it('lead do pool não é editado por quem ainda não o assumiu', async () => {
    const lead = await seedLead()

    await expect(updateLeadFor(ana(), lead.id, edit())).rejects.toThrow('Sem permissão')
  })
})

describe('listar leads', () => {
  it('filtra por status, origem, dono, pool e busca', async () => {
    const tag = unique()
    await seedLead({ name: `${tag} Zé`, company: 'Acme', status: 'contacted', source: 'site', ownerId: ana().userId })
    await seedLead({ name: `${tag} Bia`, email: `bia-${tag}@zeta.com`, emailNormalized: `bia-${tag}@zeta.com`, source: 'evento' })
    await seedLead({ name: `${tag} Cris`, company: `Empresa ${tag}`, ownerId: bruno().userId })

    const names = async (filters: Parameters<typeof listLeadsFor>[1]) => (await listLeadsFor(f.leader, { search: tag, ...filters })).leads.map((l) => l.name.replace(`${tag} `, '')).sort()

    expect(await names({})).toEqual(['Bia', 'Cris', 'Zé'])
    expect(await names({ status: 'contacted' })).toEqual(['Zé'])
    expect(await names({ source: 'evento' })).toEqual(['Bia'])
    expect(await names({ ownerId: ana().userId })).toEqual(['Zé'])
    expect(await names({ ownerId: 'pool' })).toEqual(['Bia'])
    expect(await listLeadsFor(f.leader, { search: `bia-${tag}@ZETA` })).toMatchObject({ total: 1 })
    expect(await listLeadsFor(f.leader, { search: `empresa ${tag}` })).toMatchObject({ total: 1 })
  })

  it('pagina com limite, deslocamento e total', async () => {
    const tag = unique()
    for (let i = 1; i <= 5; i++) await seedLead({ name: `${tag} ${i}` })

    const first = await listLeadsFor(f.leader, { search: tag, limit: 2, offset: 0 })
    const last = await listLeadsFor(f.leader, { search: tag, limit: 2, offset: 4 })

    expect(first.total).toBe(5)
    expect(first.leads).toHaveLength(2)
    expect(last.leads).toHaveLength(1)
    expect(new Set([...first.leads, ...last.leads].map((l) => l.id)).size).toBe(3)
  })

  it('traz o nome do dono e da equipe', async () => {
    const tag = unique()
    await seedLead({ name: tag, ownerId: ana().userId })

    const { leads: rows } = await listLeadsFor(f.leader, { search: tag })

    expect(rows[0]).toMatchObject({ ownerName: 'User 1', teamName: 'Time' })
  })

  it('membro e líder só veem a própria equipe; admin vê o tenant todo; outro tenant não vê nada', async () => {
    const tag = unique()
    await seedLead({ name: `${tag} minha` })
    await seedLead({ name: `${tag} alheia`, teamId: otherTeamId })
    await db.insert(leads).values({ tenantId: other.tenant.id, teamId: other.team.id, name: `${tag} de outro tenant` })

    const total = async (me: AuthCtx, filters = {}) => (await listLeadsFor(me, { search: tag, ...filters })).total

    expect(await total(ana())).toBe(1)
    expect(await total(f.leader)).toBe(1)
    expect(await total(outsider)).toBe(1)
    expect(await total(admin)).toBe(2)
    expect(await total(admin, { teamId: otherTeamId })).toBe(1)
    expect(await total(ana(), { teamId: otherTeamId })).toBe(0)
  })
})

describe('ver lead', () => {
  it('traz o lead, as oportunidades com a etapa e as notas', async () => {
    const lead = await seedLead({ name: 'Detalhe', ownerId: ana().userId })
    const opp = await seedOpportunity(lead, ana().userId)
    await addNoteFor(ana(), { type: 'lead', id: lead.id }, 'primeiro contato')

    const r = await getLeadFor(ana(), lead.id)

    expect(r.lead).toMatchObject({ id: lead.id, name: 'Detalhe', ownerName: 'User 1', teamName: 'Time' })
    expect(r.opportunities).toEqual([expect.objectContaining({ id: opp.id, title: 'Negócio', stageName: 'Novo', stageKind: 'open' })])
    expect(r.notes.map((n) => n.body)).toEqual(['primeiro contato'])
    expect(r).toMatchObject({ canEdit: true, canManage: false })
  })

  it('só gestor gerencia; membro que não é dono não edita', async () => {
    const lead = await seedLead({ ownerId: ana().userId })

    expect(await getLeadFor(f.leader, lead.id)).toMatchObject({ canEdit: true, canManage: true })
    expect(await getLeadFor(bruno(), lead.id)).toMatchObject({ canEdit: false, canManage: false })
  })

  it('esconde de outra equipe e de outro tenant', async () => {
    const lead = await seedLead()

    await expect(getLeadFor(outsider, lead.id)).rejects.toThrow('Lead não encontrado')
    await expect(getLeadFor(otherTenantAdmin, lead.id)).rejects.toThrow('Lead não encontrado')
  })
})

describe('excluir lead', () => {
  it('gestor exclui, as notas vão junto e a exclusão fica auditada', async () => {
    const lead = await seedLead({ name: 'Descartável' })
    await addNoteFor(f.leader, { type: 'lead', id: lead.id }, 'nota')

    await deleteLeadFor(f.leader, lead.id)

    expect(await db.select().from(leads).where(eq(leads.id, lead.id))).toHaveLength(0)
    expect(await db.select().from(notes).where(eq(notes.leadId, lead.id))).toHaveLength(0)
    const deleted = (await eventsOf(lead.id)).find((e) => e.action === 'lead.deleted')
    expect(deleted).toMatchObject({ entityType: 'lead', actorId: f.leader.userId, meta: { name: 'Descartável' } })
  })

  it('membro não exclui, mesmo sendo o dono', async () => {
    const lead = await seedLead({ ownerId: ana().userId })

    await expect(deleteLeadFor(ana(), lead.id)).rejects.toThrow('Sem permissão')
  })

  it('recusa excluir lead com oportunidades', async () => {
    const lead = await seedLead()
    await seedOpportunity(lead, null)

    await expect(deleteLeadFor(f.leader, lead.id)).rejects.toThrow('oportunidades')

    expect(await db.select().from(leads).where(eq(leads.id, lead.id))).toHaveLength(1)
  })

  it('quem não vê o lead não o exclui', async () => {
    const lead = await seedLead()

    await expect(deleteLeadFor(otherTenantAdmin, lead.id)).rejects.toThrow('Lead não encontrado')
    await expect(deleteLeadFor(outsider, lead.id)).rejects.toThrow('Lead não encontrado')
  })
})

describe('pool de leads', () => {
  it('claim concorrente: só um ganha', async () => {
    const lead = await seedLead()

    const results = await Promise.allSettled([claimLeadFor(ana(), lead.id), claimLeadFor(bruno(), lead.id)])

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)
    const [row] = await db.select().from(leads).where(eq(leads.id, lead.id))
    expect([ana().userId, bruno().userId]).toContain(row!.ownerId)
    expect(await eventsOf(lead.id)).toHaveLength(1)
  })

  it('assumir audita quem assumiu', async () => {
    const lead = await seedLead()

    await claimLeadFor(ana(), lead.id)

    const [e] = await eventsOf(lead.id)
    expect(e).toMatchObject({ action: 'lead.claimed', actorId: ana().userId, changes: { ownerId: { from: null, to: ana().userId } } })
  })

  it('não assume lead que já tem dono nem lead de outra equipe', async () => {
    const owned = await seedLead({ ownerId: bruno().userId })
    const foreign = await seedLead({ teamId: otherTeamId })

    await expect(claimLeadFor(ana(), owned.id)).rejects.toThrow('indisponível')
    await expect(claimLeadFor(ana(), foreign.id)).rejects.toThrow('indisponível')
    await expect(claimLeadFor(otherTenantAdmin, owned.id)).rejects.toThrow('indisponível')
  })
})

describe('atribuir lead', () => {
  it('gestor atribui a alguém da equipe e audita a troca', async () => {
    const lead = await seedLead({ ownerId: ana().userId })

    await assignLeadFor(f.leader, lead.id, bruno().userId)

    const [row] = await db.select().from(leads).where(eq(leads.id, lead.id))
    expect(row!.ownerId).toBe(bruno().userId)
    const [e] = await eventsOf(lead.id)
    expect(e).toMatchObject({ action: 'lead.assigned', changes: { ownerId: { from: ana().userId, to: bruno().userId } } })
  })

  it('recusa quem não é da equipe do lead ou de outro tenant', async () => {
    const lead = await seedLead()

    await expect(assignLeadFor(f.leader, lead.id, outsider.userId)).rejects.toThrow('Responsável não pertence à equipe')
    await expect(assignLeadFor(f.leader, lead.id, other.members[0]!.userId)).rejects.toThrow('Responsável não pertence à equipe')
  })

  it('membro não atribui', async () => {
    const lead = await seedLead({ ownerId: ana().userId })

    await expect(assignLeadFor(ana(), lead.id, bruno().userId)).rejects.toThrow('Sem permissão')
  })

  it('atribuir ao mesmo dono não gera evento', async () => {
    const lead = await seedLead({ ownerId: ana().userId })

    await assignLeadFor(f.leader, lead.id, ana().userId)

    expect(await eventsOf(lead.id)).toHaveLength(0)
  })
})

describe('leastLoadedOwner', () => {
  it('escolhe quem tem menos oportunidades abertas e ignora as encerradas', async () => {
    const t = await makeTenant(2)
    try {
      const [a, b] = t.members
      const lead = (await db.insert(leads).values({ tenantId: t.tenant.id, teamId: t.team.id, name: 'L' }).returning())[0]!
      await seedOpportunity(lead, t.leader.userId)
      await seedOpportunity(lead, t.leader.userId)
      await seedOpportunity(lead, a!.userId)
      await seedOpportunity(lead, a!.userId)
      await seedOpportunity(lead, b!.userId)
      await seedOpportunity(lead, b!.userId, 'won')
      await seedOpportunity(lead, b!.userId, 'won')

      expect(await leastLoadedOwner(db, t.tenant.id, t.team.id)).toBe(b!.userId)
    } finally {
      await t.cleanup()
    }
  })

  it('empate vai para o primeiro nome em ordem alfabética', async () => {
    const t = await makeTenant(2)
    try {
      expect(await leastLoadedOwner(db, t.tenant.id, t.team.id)).toBe(t.leader.userId)
    } finally {
      await t.cleanup()
    }
  })

  it('equipe sem ninguém não tem dono', async () => {
    const [empty] = await db.insert(teams).values({ tenantId: f.tenant.id, name: 'Vazia' }).returning()

    expect(await leastLoadedOwner(db, f.tenant.id, empty!.id)).toBeNull()
  })
})

describe('opções de equipe e pessoas', () => {
  it('membro e líder só enxergam a própria equipe; admin vê todas do tenant, sem gente de fora', async () => {
    const ids = (list: Array<{ id: string }>) => list.map((x) => x.id).sort()

    const mine = await leadOptionsFor(ana())
    const all = await leadOptionsFor(admin)

    expect(ids(mine.teams)).toEqual([f.team.id])
    expect(ids(mine.members)).toEqual(ids([f.leader, admin, ...f.members].map((u) => ({ id: u.userId }))))
    expect(all.teams.map((t) => t.id)).toEqual(expect.arrayContaining([f.team.id, otherTeamId]))
    expect(all.teams.map((t) => t.id)).not.toContain(other.team.id)
    expect(all.members.map((m) => m.id)).toContain(outsider.userId)
    expect(all.members.map((m) => m.id)).not.toContain(other.members[0]!.userId)
  })
})

describe('usuário sem equipe', () => {
  it('não lista leads nem opções de equipe', async () => {
    const teamless = await addUser(f, { role: 'MEMBER', team: null })

    expect(await listLeadsFor(teamless, {})).toEqual({ leads: [], total: 0 })
    expect(await leadOptionsFor(teamless)).toEqual({ teams: [], members: [] })
  })
})

describe('líder de uma equipe e membro de outra', () => {
  it('assume lead do pool da equipe que só integra, mas não de uma terceira', async () => {
    const teamB = await addTeam(f, 'B-leads')
    const me = await joinTeam(f, (await addUser(f, { role: 'TEAM_LEADER', team: f.team })).userId, teamB, 'MEMBER')
    const inB = await seedLead({ teamId: teamB.id })
    const inOther = await seedLead({ teamId: (await addTeam(f, 'C-leads')).id })

    const claimed = await claimLeadFor(me, inB.id)

    expect(claimed.ownerId).toBe(me.userId)
    await expect(claimLeadFor(me, inOther.id)).rejects.toThrow('indisponível')
  })

  it('as opções de responsável trazem a pessoa em cada equipe dela, lidas de team_members', async () => {
    const teamB = await addTeam(f, 'B-opcoes')
    const both = await joinTeam(f, (await addUser(f, { role: 'MEMBER', team: f.team })).userId, teamB)

    const { members } = await leadOptionsFor(await joinTeam(f, (await addUser(f, { role: 'MEMBER', team: f.team })).userId, teamB))

    expect(members.filter((m) => m.id === both.userId).map((m) => m.teamId).sort()).toEqual([f.team.id, teamB.id].sort())
  })
})
