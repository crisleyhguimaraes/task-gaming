import type { AuthCtx } from '#/server/roles'
import { isAdmin, isManager } from '#/server/roles'

const pad = (n: number) => n.toString().padStart(2, '0')

/** 05:03 ou 1:05:03 */
export function fmtClock(secs: number) {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = Math.floor(secs % 60)
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

/** 12m 05s · 1h 02m */
export function fmtDuration(secs: number) {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = Math.floor(secs % 60)
  if (h > 0) return `${h}h ${pad(m)}m`
  return `${m}m ${pad(s)}s`
}

export const roleLabel: Record<string, string> = {
  SUPER_ADMIN: 'Super admin',
  TENANT_ADMIN: 'Gestor geral',
  TEAM_LEADER: 'Líder de equipe',
  MEMBER: 'Membro',
}

/** Admin mostra o papel de tenant; os demais, o que fazem nas equipes: o `users.role` legado de líder não conta sem vínculo de líder. */
export const displayRole = (me: Pick<AuthCtx, 'role' | 'memberships'>) =>
  isAdmin(me) ? roleLabel[me.role] : isManager(me) ? roleLabel.TEAM_LEADER : roleLabel.MEMBER
