import { and, asc, eq } from 'drizzle-orm'
import { db } from '#/db'
import { leads, opportunities, pipelineStages } from '#/db/schema'

type Tenant = { tenant: { id: string } }

export async function addLead(f: Tenant, teamId: string, ownerId: string | null = null) {
  const [lead] = await db.insert(leads).values({ tenantId: f.tenant.id, teamId, ownerId, name: 'Lead' }).returning()
  return lead!
}

/** Direto no banco, na primeira etapa do tipo pedido do pipeline padrão do tenant. */
export async function addOpportunity(f: Tenant, lead: { id: string; teamId: string }, ownerId: string | null, kind: 'open' | 'won' = 'open') {
  const [stage] = await db
    .select()
    .from(pipelineStages)
    .where(and(eq(pipelineStages.tenantId, f.tenant.id), eq(pipelineStages.kind, kind)))
    .orderBy(asc(pipelineStages.sortOrder))
    .limit(1)
  const [opportunity] = await db
    .insert(opportunities)
    .values({ tenantId: f.tenant.id, teamId: lead.teamId, leadId: lead.id, ownerId, title: 'Negócio', pipelineId: stage!.pipelineId, stageId: stage!.id })
    .returning()
  return opportunity!
}
