import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { leads, opportunities, pipelineStages, teams } from '#/db/schema'
import { createTaskFor } from './tasks.core'
import { makeTenant } from './test-fixtures'

let f: Awaited<ReturnType<typeof makeTenant>>
let other: Awaited<ReturnType<typeof makeTenant>>

async function newOpportunity(tenant: typeof f, teamId = tenant.team.id) {
  const [lead] = await db.insert(leads).values({ tenantId: tenant.tenant.id, teamId, name: 'Lead' }).returning()
  const [stage] = await db.select().from(pipelineStages).where(and(eq(pipelineStages.tenantId, tenant.tenant.id), eq(pipelineStages.kind, 'open'))).limit(1)
  const [opp] = await db
    .insert(opportunities)
    .values({ tenantId: tenant.tenant.id, teamId, leadId: lead!.id, title: 'Negócio', pipelineId: stage!.pipelineId, stageId: stage!.id })
    .returning()
  return opp!
}

const followUp = (opportunityId: string) => ({ title: 'Ligar', basePoints: 10, estimatedMinutes: 15, teamId: f.team.id, assignedToId: null, opportunityId })

beforeAll(async () => {
  f = await makeTenant(0)
  other = await makeTenant(0)
})
afterAll(async () => {
  await f.cleanup()
  await other.cleanup()
  await db.$client.end()
})

describe('follow-up de oportunidade', () => {
  it('cria a tarefa ligada à oportunidade da mesma equipe', async () => {
    const opp = await newOpportunity(f)

    const task = await createTaskFor(f.leader, followUp(opp.id))

    expect(task.opportunityId).toBe(opp.id)
  })

  it('recusa oportunidade de outro tenant', async () => {
    const foreign = await newOpportunity(other)

    await expect(createTaskFor(f.leader, followUp(foreign.id))).rejects.toThrow('Oportunidade não encontrada')
  })

  it('recusa oportunidade de outra equipe do mesmo tenant', async () => {
    const [team2] = await db.insert(teams).values({ tenantId: f.tenant.id, name: 'Outra' }).returning()
    const opp = await newOpportunity(f, team2!.id)

    await expect(createTaskFor(f.leader, followUp(opp.id))).rejects.toThrow('Oportunidade não encontrada')
  })
})
