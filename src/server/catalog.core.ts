import { and, asc, eq, inArray, or } from 'drizzle-orm'
import { teams } from '#/db/schema'
import type { AuditMeta } from '#/db/schema'
import { fail } from './roles'
import type { Reader, Tx } from './tx'

export const DEFAULT_ITEM_NAME = 'Padrão'

/** A coluna de `teams` que aponta para o item do catálogo. NULL é o padrão do tenant, então o padrão nunca é alvo de vínculo. */
export type TeamLink = { key: 'goalId' | 'scoringRuleId'; column: typeof teams.goalId | typeof teams.scoringRuleId }

export const goalLink = { key: 'goalId', column: teams.goalId } satisfies TeamLink
export const scoringRuleLink = { key: 'scoringRuleId', column: teams.scoringRuleId } satisfies TeamLink

export type TeamsDiff = { added: Array<string>; removed: Array<string> }

const idsText = (ids: ReadonlyArray<string>) => [...ids].sort().join(',')

export const teamsAuditMeta = (name: string, { added, removed }: TeamsDiff): AuditMeta => ({ name, added: idsText(added), removed: idsText(removed) })

/**
 * Faz de `itemId` o item de exatamente as equipes `wantedIds`. Trava as equipes envolvidas (as pedidas e as que usam o item hoje)
 * para o diff ser exato; quem chama já travou a linha do item, o que enfileira dois administradores no mesmo item.
 */
export async function replaceTeamsOfItem(tx: Tx, tenantId: string, link: TeamLink, itemId: string, wantedIds: ReadonlyArray<string>): Promise<TeamsDiff> {
  const wanted = [...new Set(wantedIds)]
  const involved = await tx
    .select({ id: teams.id, itemId: link.column })
    .from(teams)
    .where(and(eq(teams.tenantId, tenantId), or(wanted.length ? inArray(teams.id, wanted) : undefined, eq(link.column, itemId))))
    .for('update')
  if (wanted.some((id) => !involved.some((team) => team.id === id))) fail('Equipe não encontrada')
  const current = involved.filter((team) => team.itemId === itemId).map((team) => team.id)
  const added = wanted.filter((id) => !current.includes(id))
  const removed = current.filter((id) => !wanted.includes(id))
  if (added.length) await tx.update(teams).set({ [link.key]: itemId }).where(inArray(teams.id, added))
  if (removed.length) await tx.update(teams).set({ [link.key]: null }).where(inArray(teams.id, removed))
  return { added: added.sort(), removed: removed.sort() }
}

/** As equipes de cada item, pela chave do item; a chave `null` reúne as equipes sem vínculo, que usam o padrão. */
export async function teamsByItem(tx: Reader, tenantId: string, link: TeamLink) {
  const rows = await tx.select({ id: teams.id, name: teams.name, itemId: link.column }).from(teams).where(eq(teams.tenantId, tenantId)).orderBy(asc(teams.name))
  const byItem = new Map<string | null, Array<{ id: string; name: string }>>()
  for (const { itemId, ...team } of rows) byItem.set(itemId, [...(byItem.get(itemId) ?? []), team])
  return byItem
}
