import type { TeamRef } from '#/components/teams/model'
import type { AuthCtx } from '#/server/roles'
import { canManageWith } from '#/server/roles'

/** Equipes com quem `me` pode compartilhar o desafio: as que gerencia com `challenge.share`, fora a dona. */
export const shareableTeams = (me: Pick<AuthCtx, 'role' | 'memberships' | 'capabilityOverrides'>, managedTeams: ReadonlyArray<TeamRef>, ownerId: string) =>
  managedTeams.filter((team) => team.id !== ownerId && canManageWith(me, 'challenge.share', team.id))
