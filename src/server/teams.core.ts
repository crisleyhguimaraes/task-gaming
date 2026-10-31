import { and, asc, count, eq } from 'drizzle-orm'
import { db } from '#/db'
import { challenges, leads, tasks, teamMembers, teams } from '#/db/schema'
import { recordAudit } from './audit.core'
import { failOnDuplicate } from './duplicate'
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
    const [team] = await failOnDuplicate('Já existe uma equipe com esse nome', tx.insert(teams).values({ tenantId: me.tenantId, name: name.trim() }).returning())
    await recordAudit(tx, me, { action: 'team.created', entityType: 'team', entityId: team!.id, meta: { name: team!.name } })
    return team!
  })
}

export async function deleteTeamFor(me: AuthCtx, teamId: string) {
  await db.transaction(async (tx) => {
    const [team] = await tx.select().from(teams).where(and(eq(teams.id, teamId), eq(teams.tenantId, me.tenantId)))
    if (!team) fail('Equipe não encontrada')
    for (const table of [teamMembers, tasks, challenges, leads]) {
      const [owned] = await tx.select({ n: count() }).from(table).where(and(eq(table.teamId, teamId), eq(table.tenantId, me.tenantId)))
      if (owned!.n > 0) fail('Equipe tem membros, tarefas, desafios ou leads; não pode ser excluída')
    }
    await tx.delete(teams).where(eq(teams.id, teamId))
    await recordAudit(tx, me, { action: 'team.deleted', entityType: 'team', entityId: teamId, meta: { name: team.name } })
  })
}

export function listTeamsFor(me: AuthCtx) {
  return db
    .select({ id: teams.id, name: teams.name, members: count(teamMembers.userId) })
    .from(teams)
    .leftJoin(teamMembers, eq(teamMembers.teamId, teams.id))
    .where(eq(teams.tenantId, me.tenantId))
    .groupBy(teams.id)
    .orderBy(asc(teams.name))
}
