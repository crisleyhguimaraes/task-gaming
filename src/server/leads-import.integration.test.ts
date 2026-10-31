import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { auditEvents, leads, opportunities, pipelineStages, teams } from '#/db/schema'
import { maxImportRows } from '#/lib/leads'
import type { RawLeadRow } from '#/lib/leads'
import { importLeadsFor, previewLeadImportFor } from './leads-import.core'
import type { AuthCtx } from './roles'
import { addAdmin, makeTenant } from './test-fixtures'

let f: Awaited<ReturnType<typeof makeTenant>>
let other: Awaited<ReturnType<typeof makeTenant>>
let admin: AuthCtx
let otherTeamId: string

const unique = () => Math.random().toString(36).slice(2, 10)

const run = (rows: Array<RawLeadRow>, patch: Partial<Parameters<typeof importLeadsFor>[1]> = {}, me: AuthCtx = f.leader) =>
  importLeadsFor(me, { teamId: f.team.id, rows, onDuplicate: 'skip', distribute: 'none', ...patch })

const leadsOf = (tenantId: string, teamId?: string) =>
  db.select().from(leads).where(and(eq(leads.tenantId, tenantId), teamId ? eq(leads.teamId, teamId) : undefined))

beforeAll(async () => {
  f = await makeTenant(2)
  other = await makeTenant(1)
  admin = await addAdmin(f)
  const [team2] = await db.insert(teams).values({ tenantId: f.tenant.id, name: 'Outra equipe' }).returning()
  otherTeamId = team2!.id
})
afterAll(async () => {
  await f.cleanup()
  await other.cleanup()
  await db.$client.end()
})

describe('importar leads', () => {
  it('lote misto: cria as válidas, normaliza e relata a inválida pela posição', async () => {
    const tag = unique()
    const result = await run([
      { name: `${tag} Ana`, email: ` ANA-${tag}@Acme.com `, phone: '(11) 98765-4321', company: 'Acme', source: 'Indicação' },
      { name: '', email: 'sem-nome@acme.com' },
      { name: `${tag} Bia`, email: 'errado' },
      { name: `${tag} Caio` },
    ])

    expect(result).toEqual({
      created: 2,
      updated: 0,
      skipped: 0,
      errors: [
        { row: 2, messages: ['Informe o nome'] },
        { row: 3, messages: ['E-mail inválido'] },
      ],
    })
    const saved = (await leadsOf(f.tenant.id, f.team.id)).filter((l) => l.name.startsWith(tag))
    expect(saved).toHaveLength(2)
    expect(saved.find((l) => l.name.endsWith('Ana'))).toMatchObject({
      emailNormalized: `ana-${tag}@acme.com`,
      phoneDigits: '11987654321',
      source: 'indicacao',
      company: 'Acme',
      ownerId: null,
      status: 'new',
      teamId: f.team.id,
      createdById: f.leader.userId,
    })
  })

  it('duplicado dentro do lote: a primeira linha vence, por e-mail ou por telefone', async () => {
    const tag = unique()

    const result = await run([
      { name: `${tag} A`, email: `${tag}@acme.com`, phone: '11 91234-5678' },
      { name: `${tag} B`, email: `${tag.toUpperCase()}@acme.com` },
      { name: `${tag} C`, phone: '(11) 9 1234-5678' },
      { name: `${tag} D`, email: `outro-${tag}@acme.com` },
    ])

    expect(result).toMatchObject({ created: 2, skipped: 2, updated: 0, errors: [] })
    const names = (await leadsOf(f.tenant.id, f.team.id)).filter((l) => l.name.startsWith(tag)).map((l) => l.name.slice(-1)).sort()
    expect(names).toEqual(['A', 'D'])
  })

  it('duplicado no banco com "pular": nada muda', async () => {
    const tag = unique()
    const [existing] = await db.insert(leads).values({ tenantId: f.tenant.id, teamId: f.team.id, name: 'Original', email: `${tag}@acme.com`, emailNormalized: `${tag}@acme.com` }).returning()

    const result = await run([{ name: 'Novo nome', email: `${tag}@acme.com` }], { onDuplicate: 'skip' })

    expect(result).toMatchObject({ created: 0, updated: 0, skipped: 1 })
    expect((await db.select().from(leads).where(eq(leads.id, existing!.id)))[0]!.name).toBe('Original')
  })

  it('duplicado no banco com "atualizar": sobrescreve o que veio preenchido e preserva o resto', async () => {
    const tag = unique()
    const [existing] = await db
      .insert(leads)
      .values({
        tenantId: f.tenant.id,
        teamId: f.team.id,
        ownerId: f.members[0]!.userId,
        name: 'Original',
        company: 'Empresa Velha',
        phone: '11 90000-0000',
        phoneDigits: '11900000000',
        email: `${tag}@acme.com`,
        emailNormalized: `${tag}@acme.com`,
        source: 'evento',
        status: 'qualified',
      })
      .returning()

    const result = await run([{ name: 'Nome Novo', email: `${tag}@acme.com`, company: '', phone: '(21) 98888-7777', source: 'site' }], { onDuplicate: 'update' })

    expect(result).toMatchObject({ created: 0, updated: 1, skipped: 0 })
    const [row] = await db.select().from(leads).where(eq(leads.id, existing!.id))
    expect(row).toMatchObject({
      name: 'Nome Novo',
      company: 'Empresa Velha',
      phoneDigits: '21988887777',
      source: 'evento',
      status: 'qualified',
      ownerId: f.members[0]!.userId,
    })
    expect(await leadsOf(f.tenant.id, f.team.id).then((all) => all.filter((l) => l.emailNormalized === `${tag}@acme.com`))).toHaveLength(1)
  })

  it('duplicado de lead de outra equipe do mesmo tenant também conta', async () => {
    const tag = unique()
    await db.insert(leads).values({ tenantId: f.tenant.id, teamId: otherTeamId, name: 'De lá', email: `${tag}@acme.com`, emailNormalized: `${tag}@acme.com` })

    const result = await run([{ name: 'Daqui', email: `${tag}@acme.com` }])

    expect(result).toMatchObject({ created: 0, skipped: 1 })
  })

  it('"atualizar" nunca sobrescreve lead de outra equipe do mesmo tenant: conta como pulado', async () => {
    const tag = unique()
    const [foreign] = await db
      .insert(leads)
      .values({ tenantId: f.tenant.id, teamId: otherTeamId, name: 'Da outra equipe', company: 'Empresa B', email: `${tag}@acme.com`, emailNormalized: `${tag}@acme.com` })
      .returning()

    const result = await run([{ name: 'Sobrescrita', company: 'Empresa A', email: `${tag}@acme.com`, phone: '(11) 97777-6666' }], { onDuplicate: 'update' })

    expect(result).toMatchObject({ created: 0, updated: 0, skipped: 1 })
    expect((await db.select().from(leads).where(eq(leads.id, foreign!.id)))[0]).toMatchObject({ name: 'Da outra equipe', company: 'Empresa B', phoneDigits: null })
  })

  it('nem o admin sobrescreve lead de outra equipe ao importar para a sua: só importando na equipe dona', async () => {
    const tag = unique()
    const [foreign] = await db.insert(leads).values({ tenantId: f.tenant.id, teamId: otherTeamId, name: 'Original B', email: `${tag}@acme.com`, emailNormalized: `${tag}@acme.com` }).returning()

    const wrongTeam = await run([{ name: 'Novo nome', email: `${tag}@acme.com` }], { onDuplicate: 'update' }, admin)
    const ownerTeam = await run([{ name: 'Novo nome', email: `${tag}@acme.com` }], { onDuplicate: 'update', teamId: otherTeamId }, admin)

    expect(wrongTeam).toMatchObject({ updated: 0, skipped: 1 })
    expect(ownerTeam).toMatchObject({ updated: 1, skipped: 0 })
    expect((await db.select().from(leads).where(eq(leads.id, foreign!.id)))[0]!.name).toBe('Novo nome')
  })

  it('cada lead atualizado deixa um evento com o valor antigo e o novo; sem mudança, sem evento', async () => {
    const tag = unique()
    const [changed] = await db
      .insert(leads)
      .values({ tenantId: f.tenant.id, teamId: f.team.id, name: 'Antes', company: 'Mesma', email: `a-${tag}@acme.com`, emailNormalized: `a-${tag}@acme.com` })
      .returning()
    const [same] = await db
      .insert(leads)
      .values({ tenantId: f.tenant.id, teamId: f.team.id, name: 'Igual', email: `b-${tag}@acme.com`, emailNormalized: `b-${tag}@acme.com` })
      .returning()

    await run([{ name: 'Depois', email: `a-${tag}@acme.com`, company: 'Mesma' }, { name: 'Igual', email: `b-${tag}@acme.com` }], { onDuplicate: 'update' })

    const eventsOf = (id: string) => db.select().from(auditEvents).where(and(eq(auditEvents.tenantId, f.tenant.id), eq(auditEvents.entityId, id)))
    expect(await eventsOf(changed!.id)).toMatchObject([{ action: 'lead.updated', actorId: f.leader.userId, changes: { name: { from: 'Antes', to: 'Depois' } }, meta: { via: 'importação' } }])
    expect(await eventsOf(same!.id)).toHaveLength(0)
  })

  it('o mesmo contato em outro tenant não é duplicado e não é tocado', async () => {
    const tag = unique()
    const [foreign] = await db.insert(leads).values({ tenantId: other.tenant.id, teamId: other.team.id, name: 'Alheio', email: `${tag}@acme.com`, emailNormalized: `${tag}@acme.com` }).returning()

    const result = await run([{ name: 'Meu', email: `${tag}@acme.com` }], { onDuplicate: 'update' })

    expect(result).toMatchObject({ created: 1, updated: 0 })
    expect((await db.select().from(leads).where(eq(leads.id, foreign!.id)))[0]!.name).toBe('Alheio')
  })

  it('aceita exatamente 2000 linhas e recusa 2001', async () => {
    const tag = unique()
    const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `${tag} ${i}`, email: `${tag}-${i}@acme.com` }))

    await expect(run(rows(maxImportRows + 1))).rejects.toThrow('2000')
    expect(await run(rows(maxImportRows))).toMatchObject({ created: maxImportRows })
  })

  it('"menos carregado" reparte o lote levando em conta as oportunidades abertas', async () => {
    const t = await makeTenant(2)
    try {
      const [a, b] = t.members
      const [lead] = await db.insert(leads).values({ tenantId: t.tenant.id, teamId: t.team.id, name: 'Base' }).returning()
      const [stage] = await db.select().from(pipelineStages).where(and(eq(pipelineStages.tenantId, t.tenant.id), eq(pipelineStages.kind, 'open'))).limit(1)
      await db.insert(opportunities).values(
        [t.leader, t.leader, t.leader, t.leader].map((owner) => ({ tenantId: t.tenant.id, teamId: t.team.id, leadId: lead!.id, ownerId: owner.userId, title: 'N', pipelineId: stage!.pipelineId, stageId: stage!.id })),
      )
      const rows = Array.from({ length: 6 }, (_, i) => ({ name: `Lead ${i}`, email: `l${i}@acme.com` }))

      await importLeadsFor(t.leader, { teamId: t.team.id, rows, onDuplicate: 'skip', distribute: 'least_loaded' })

      const imported = (await leadsOf(t.tenant.id)).filter((l) => l.id !== lead!.id)
      const countOf = (ownerId: string) => imported.filter((l) => l.ownerId === ownerId).length
      expect([countOf(a!.userId), countOf(b!.userId), countOf(t.leader.userId)]).toEqual([3, 3, 0])
    } finally {
      await t.cleanup()
    }
  })

  it('sem distribuição, os leads ficam no pool', async () => {
    const tag = unique()

    await run([{ name: `${tag} Pool`, email: `${tag}@acme.com` }], { distribute: 'none' })

    const saved = (await leadsOf(f.tenant.id, f.team.id)).find((l) => l.name === `${tag} Pool`)
    expect(saved!.ownerId).toBeNull()
  })

  it('audita o lote com um evento de contagens, mais um evento por lead atualizado', async () => {
    const t = await makeTenant(1)
    try {
      await db.insert(leads).values({ tenantId: t.tenant.id, teamId: t.team.id, name: 'Antigo', email: 'antigo@acme.com', emailNormalized: 'antigo@acme.com' })

      await importLeadsFor(t.leader, {
        teamId: t.team.id,
        onDuplicate: 'update',
        distribute: 'least_loaded',
        rows: [{ name: 'Novo', email: 'novo@acme.com' }, { name: 'Antigo 2', email: 'antigo@acme.com' }, { name: '' }, { name: 'Novo', email: 'novo@acme.com' }],
      })

      const events = await db.select().from(auditEvents).where(eq(auditEvents.tenantId, t.tenant.id))
      expect(events.map((e) => e.action).sort()).toEqual(['lead.imported', 'lead.updated'])
      expect(events.find((e) => e.action === 'lead.imported')).toMatchObject({
        action: 'lead.imported',
        entityType: 'team',
        entityId: t.team.id,
        actorId: t.leader.userId,
        meta: { created: 1, updated: 1, skipped: 1, errors: 1, onDuplicate: 'update', distribute: 'least_loaded' },
      })
    } finally {
      await t.cleanup()
    }
  })

  it('só gestores importam, e só na própria equipe; admin importa em qualquer uma', async () => {
    const rows = [{ name: unique() }]

    await expect(run(rows, {}, f.members[0])).rejects.toThrow('Sem permissão')
    await expect(run(rows, { teamId: otherTeamId }, f.leader)).rejects.toThrow('Sem permissão')
    await expect(run(rows, { teamId: other.team.id }, admin)).rejects.toThrow('Equipe não encontrada')
    expect(await run(rows, { teamId: otherTeamId }, admin)).toMatchObject({ created: 1 })
  })
})

describe('prévia da importação', () => {
  it('classifica cada linha sem gravar nada', async () => {
    const tag = unique()
    await db.insert(leads).values({ tenantId: f.tenant.id, teamId: f.team.id, name: 'Já existe', email: `${tag}@acme.com`, emailNormalized: `${tag}@acme.com` })

    const preview = await previewLeadImportFor(f.leader, {
      teamId: f.team.id,
      rows: [{ name: 'Nova', email: `nova-${tag}@acme.com` }, { name: 'Repetida', email: `NOVA-${tag}@acme.com` }, { name: 'Banco', email: `${tag}@acme.com` }, { name: '' }],
    })

    expect(preview).toEqual([
      { row: 1, status: 'new', messages: [] },
      { row: 2, status: 'repeated', messages: [] },
      { row: 3, status: 'duplicate', messages: [] },
      { row: 4, status: 'invalid', messages: ['Informe o nome'] },
    ])
    expect((await leadsOf(f.tenant.id)).filter((l) => l.emailNormalized === `nova-${tag}@acme.com`)).toHaveLength(0)
  })

  it('exige a mesma permissão da importação', async () => {
    await expect(previewLeadImportFor(f.members[0]!, { teamId: f.team.id, rows: [] })).rejects.toThrow('Sem permissão')
  })
})
