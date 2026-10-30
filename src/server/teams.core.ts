import { and, count, eq } from 'drizzle-orm'
import { db } from '#/db'
import { tasks, teams } from '#/db/schema'
import { recordAudit } from './audit.core'
import type { AuthCtx } from './roles'
import { fail } from './roles'

export async function assertTeamInTenant(tx: Pick<typeof db, 'select'>, tenantId: string, teamId: string | null) {
  if (!teamId) return
  const [t] = await tx.select({ id: teams.id }).from(teams).where(and(eq(teams.id, teamId), eq(teams.tenantId, tenantId)))
  if (!t) fail('Equipe não encontrada')
}

export async function createTeamFor(me: AuthCtx, name: string) {
  return db.transaction(async (tx) => {
    const [team] = await tx.insert(teams).values({ tenantId: me.tenantId, name }).returning()
    await recordAudit(tx, me, { action: 'team.created', entityType: 'team', entityId: team!.id, meta: { name } })
    return team!
  })
}

export async function deleteTeamFor(me: AuthCtx, teamId: string) {
  await db.transaction(async (tx) => {
    const [team] = await tx.select().from(teams).where(and(eq(teams.id, teamId), eq(teams.tenantId, me.tenantId)))
    if (!team) fail('Equipe não encontrada')
    const [{ n } = { n: 0 }] = await tx.select({ n: count() }).from(tasks).where(and(eq(tasks.teamId, teamId), eq(tasks.tenantId, me.tenantId)))
    if (n > 0) fail('Equipe tem tarefas; não pode ser excluída')
    await tx.delete(teams).where(eq(teams.id, teamId))
    await recordAudit(tx, me, { action: 'team.deleted', entityType: 'team', entityId: teamId, meta: { name: team.name } })
  })
}
