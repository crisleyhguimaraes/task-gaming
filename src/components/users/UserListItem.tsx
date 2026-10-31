import { UserCheck, UserX } from 'lucide-react'
import type { Act } from '#/components/useAttempt'
import { roleLabel } from '#/lib/format'
import type { AuthCtx } from '#/server/roles'
import { can, isAdmin } from '#/server/roles'
import { removeTeamMember, setTeamMemberRole } from '#/server/team-members'
import { deactivateUser, reactivateUser, updateUser } from '#/server/users'
import { AddToTeam } from './AddToTeam'
import type { Membership, Team, UserRow } from './model'
import { canDeactivate, canRemoveFromTeam, tenantRoleOf } from './model'
import { TeamChip } from './TeamChip'

type Props = { user: UserRow; me: AuthCtx; teams: ReadonlyArray<Team>; act: Act }

const iconButton = 'rounded-lg p-2 text-neutral-500 hover:bg-neutral-900'

export function UserListItem({ user, me, teams, act }: Props) {
  const admin = isAdmin(me)
  const canChangeTenantRole = can(me, 'user.update') && user.id !== me.userId

  function removeFromTeam(link: Membership) {
    if (!confirm(`Remover ${user.name} da equipe ${link.teamName}? O trabalho aberto dela nessa equipe volta ao pool.`)) return
    act(() => removeTeamMember({ data: { userId: user.id, teamId: link.teamId } }))
  }

  function deactivate() {
    const reason = prompt(`Desativar ${user.name}? A pessoa perde o acesso agora e as tarefas abertas voltam ao pool.\n\nMotivo (opcional):`)
    if (reason === null) return
    act(() => deactivateUser({ data: { userId: user.id, reason: reason.trim() || undefined } }))
  }

  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className={`min-w-0 ${user.banned ? 'opacity-60' : ''}`}>
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{user.name}</span>
            {user.banned && <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[11px] font-medium text-rose-400">desativado</span>}
          </div>
          <div className="truncate text-xs text-neutral-500">{user.email}</div>
        </div>
        <div className="flex items-center gap-1">
          {canChangeTenantRole ? (
            <select
              aria-label={`Papel de ${user.name} na organização`}
              value={tenantRoleOf(user.role)}
              onChange={(e) => act(() => updateUser({ data: { userId: user.id, role: tenantRoleOf(e.target.value) } }))}
              className="w-auto py-1 text-xs"
            >
              <option value="MEMBER">{roleLabel.MEMBER}</option>
              <option value="TENANT_ADMIN">{roleLabel.TENANT_ADMIN}</option>
            </select>
          ) : (
            <span className="text-xs text-neutral-400">{roleLabel[tenantRoleOf(user.role)]}</span>
          )}
          {canDeactivate(me, user) &&
            (user.banned ? (
              <button onClick={() => act(() => reactivateUser({ data: { userId: user.id } }))} aria-label={`Reativar ${user.name}`} title="Reativar" className={`${iconButton} hover:text-xp-400`}><UserCheck className="h-4 w-4" /></button>
            ) : (
              <button onClick={deactivate} aria-label={`Desativar ${user.name}`} title="Desativar" className={`${iconButton} hover:text-rose-400`}><UserX className="h-4 w-4" /></button>
            ))}
        </div>
      </div>
      {user.memberships.length === 0 ? (
        <p className="text-xs text-neutral-500">Sem equipe</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {user.memberships.map((link) => (
            <TeamChip
              key={link.teamId}
              link={link}
              personName={user.name}
              onChangeRole={admin ? (role) => act(() => setTeamMemberRole({ data: { userId: user.id, teamId: link.teamId, role } })) : undefined}
              onRemove={canRemoveFromTeam(me, link) ? () => removeFromTeam(link) : undefined}
            />
          ))}
        </ul>
      )}
      {admin && <AddToTeam user={user} teams={teams} act={act} />}
    </li>
  )
}
