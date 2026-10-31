import type { AuthCtx } from '#/server/roles'
import { isAdmin } from '#/server/roles'

/**
 * `setChallengeTeams` troca a lista inteira: as vinculadas que a pessoa não gerencia seguem como estão
 * (senão ela as estaria tirando) e só as gerenciadas obedecem à marcação.
 */
export function nextSharedTeamIds(currentIds: ReadonlyArray<string>, manageableIds: ReadonlyArray<string>, pickedIds: ReadonlyArray<string>) {
  const foreign = currentIds.filter((id) => !manageableIds.includes(id))
  return [...foreign, ...pickedIds.filter((id) => manageableIds.includes(id))]
}

/** A dona entra na conta: o número é de equipes que competem. */
export function sharingLabel({ tenantWide, sharedTeamCount }: { tenantWide: boolean; sharedTeamCount: number }) {
  if (tenantWide) return 'Toda a empresa'
  if (sharedTeamCount === 0) return null
  return `Compartilhado · ${sharedTeamCount + 1} equipes`
}

export function cannotCompeteReason(me: Pick<AuthCtx, 'role' | 'memberships'>) {
  if (isAdmin(me) && me.memberships.length === 0) return 'Administradores sem equipe veem o desafio, mas não competem. Entre em uma equipe para tentar.'
  return 'Nenhuma das suas equipes participa deste desafio.'
}
