import { and, eq } from 'drizzle-orm'
import type { db } from '#/db'
import { teams } from '#/db/schema'
import { fail } from './roles'

export async function assertTeamInTenant(tx: Pick<typeof db, 'select'>, tenantId: string, teamId: string | null) {
  if (!teamId) return
  const [t] = await tx.select({ id: teams.id }).from(teams).where(and(eq(teams.id, teamId), eq(teams.tenantId, tenantId)))
  if (!t) fail('Equipe não encontrada')
}
