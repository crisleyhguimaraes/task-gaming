import type { AuthCtx } from '#/server/roles'
import { can, isAdmin, roleIn } from '#/server/roles'
import { plural } from './format'

/** Valor do filtro de tarefas que pede as que não estão em nenhum board. */
export const NO_BOARD = 'none'

type BoardManager = Pick<AuthCtx, 'role' | 'memberships' | 'capabilityOverrides'>

/** Admin gerencia qualquer board. Líder, só o vinculado exclusivamente a equipes que ele lidera: board sem vínculo ou compartilhado com equipe alheia é do admin. */
export function canManageBoard(me: BoardManager, linkedTeamIds: ReadonlyArray<string>) {
  if (isAdmin(me)) return true
  return linkedTeamIds.length > 0 && linkedTeamIds.every((teamId) => roleIn(me, teamId) === 'LEADER' && can(me, 'board.manage', teamId))
}

export const countTasks = (n: number) => plural(n, 'tarefa', 'tarefas')
