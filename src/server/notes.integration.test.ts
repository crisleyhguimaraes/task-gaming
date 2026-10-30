import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { auditEvents, leads, opportunities, pipelineStages, tasks, teams, users } from '#/db/schema'
import { addNoteFor, listNotesFor } from './notes.core'
import type { AuthCtx } from './roles'
import { makeTenant } from './test-fixtures'

let f: Awaited<ReturnType<typeof makeTenant>>
let other: Awaited<ReturnType<typeof makeTenant>>
let outsider: AuthCtx

const newTask = async () => {
  const [t] = await db
    .insert(tasks)
    .values({ tenantId: f.tenant.id, teamId: f.team.id, createdById: f.leader.userId, title: 'T', basePoints: 1, estimatedSeconds: 60 })
    .returning()
  return t!
}

async function newOpportunity(tenantId: string, teamId: string) {
  const [lead] = await db.insert(leads).values({ tenantId, teamId, name: 'Lead' }).returning()
  const [stage] = await db.select().from(pipelineStages).where(and(eq(pipelineStages.tenantId, tenantId), eq(pipelineStages.kind, 'open'))).limit(1)
  const [opp] = await db.insert(opportunities).values({ tenantId, teamId, leadId: lead!.id, title: 'Negócio', stageId: stage!.id }).returning()
  return { lead: lead!, opp: opp! }
}

beforeAll(async () => {
  f = await makeTenant(1)
  other = await makeTenant(0)
  const [team2] = await db.insert(teams).values({ tenantId: f.tenant.id, name: 'Outra equipe' }).returning()
  await db.insert(users).values({ id: `out-${f.tenant.slug}`, name: 'Fora', email: `out-${f.tenant.slug}@test.local`, role: 'MEMBER', tenantId: f.tenant.id, teamId: team2!.id })
  outsider = { userId: `out-${f.tenant.slug}`, tenantId: f.tenant.id, teamId: team2!.id, role: 'MEMBER', name: 'Fora', impersonatedBy: null, mustChangePassword: false }
})
afterAll(async () => {
  await f.cleanup()
  await other.cleanup()
  await db.$client.end()
})

describe('notas', () => {
  it('quem vê a tarefa comenta, e a nota sai com o nome do autor, em ordem', async () => {
    const t = await newTask()

    await addNoteFor(f.members[0]!, { type: 'task', id: t.id }, '  primeiro  ')
    await addNoteFor(f.leader, { type: 'task', id: t.id }, 'segundo')

    const notes = await listNotesFor(f.members[0]!, { type: 'task', id: t.id })
    expect(notes.map((n) => [n.body, n.authorName])).toEqual([
      ['primeiro', 'User 1'],
      ['segundo', 'User 0'],
    ])
  })

  it('registra a nota na auditoria', async () => {
    const t = await newTask()

    await addNoteFor(f.leader, { type: 'task', id: t.id }, 'x')

    const [e] = await db.select().from(auditEvents).where(and(eq(auditEvents.tenantId, f.tenant.id), eq(auditEvents.entityId, t.id)))
    expect(e).toMatchObject({ action: 'note.created', entityType: 'task', actorId: f.leader.userId })
  })

  it('de outra equipe, ninguém lê nem escreve', async () => {
    const t = await newTask()

    await expect(addNoteFor(outsider, { type: 'task', id: t.id }, 'x')).rejects.toThrow('Registro não encontrado')
    await expect(listNotesFor(outsider, { type: 'task', id: t.id })).rejects.toThrow('Registro não encontrado')
  })

  it('funciona em lead e oportunidade da mesma equipe, e esconde de outro tenant', async () => {
    const { lead, opp } = await newOpportunity(f.tenant.id, f.team.id)
    const foreign = await newOpportunity(other.tenant.id, other.team.id)

    await addNoteFor(f.members[0]!, { type: 'lead', id: lead.id }, 'ligou')
    await addNoteFor(f.members[0]!, { type: 'opportunity', id: opp.id }, 'proposta enviada')

    expect(await listNotesFor(f.leader, { type: 'lead', id: lead.id })).toHaveLength(1)
    expect(await listNotesFor(f.leader, { type: 'opportunity', id: opp.id })).toHaveLength(1)
    await expect(listNotesFor(f.leader, { type: 'opportunity', id: foreign.opp.id })).rejects.toThrow('Registro não encontrado')
    await expect(addNoteFor(outsider, { type: 'lead', id: lead.id }, 'x')).rejects.toThrow('Registro não encontrado')
  })

  it('recusa nota vazia ou grande demais', async () => {
    const t = await newTask()

    await expect(addNoteFor(f.leader, { type: 'task', id: t.id }, '   ')).rejects.toThrow('Escreva alguma coisa')
    await expect(addNoteFor(f.leader, { type: 'task', id: t.id }, 'a'.repeat(2001))).rejects.toThrow('2000')
  })
})
