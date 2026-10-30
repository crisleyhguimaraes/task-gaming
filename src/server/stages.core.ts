import type { db } from '#/db'
import { pipelineStages } from '#/db/schema'
import { defaultStages } from '#/lib/pipeline'

export async function insertDefaultStages(tx: Pick<typeof db, 'insert'>, tenantId: string) {
  await tx.insert(pipelineStages).values(defaultStages.map((stage, i) => ({ tenantId, ...stage, sortOrder: i + 1 })))
}
