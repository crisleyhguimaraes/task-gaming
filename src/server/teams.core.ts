import { and, count, eq } from 'drizzle-orm'
import { db } from '#/db'
import { challenges, leads, tasks, teams, users } from '#/db/schema'
import { recordAudit } from './audit.core'
import type { AuthCtx } from './roles'
import { fail } from './roles'
import type { Reader } from './tx'

export async function assertTeamInTenant(tx: Reader, tenantId: string, teamId: string | null) {
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
    for (const table of [users, tasks, challenges, leads]) {
      const [owned] = await tx.select({ n: count() }).from(table).where(and(eq(table.teamId, teamId), eq(table.tenantId, me.tenantId)))
      if (owned!.n > 0) fail('Equipe tem membros, tarefas, desafios ou leads; não pode ser excluída')
    }
    await tx.delete(teams).where(eq(teams.id, teamId))
    await recordAudit(tx, me, { action: 'team.deleted', entityType: 'team', entityId: teamId, meta: { name: team.name } })
  })
}
