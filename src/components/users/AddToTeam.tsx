import { Plus } from 'lucide-react'
import type { FormEvent } from 'react'
import { teamRoles } from '#/lib/access'
import { addTeamMember } from '#/server/team-members'
import type { Act, Team, UserRow } from './model'
import { teamRoleLabel, teamRoleOf } from './model'

export function AddToTeam({ user, teams, act }: { user: UserRow; teams: ReadonlyArray<Team>; act: Act }) {
  const available = teams.filter((t) => !user.memberships.some((m) => m.teamId === t.id))
  if (available.length === 0) return null

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    act(() => addTeamMember({ data: { userId: user.id, teamId: String(f.get('teamId')), role: teamRoleOf(f.get('teamRole')) } }))
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2">
      <select name="teamId" aria-label={`Equipe para adicionar ${user.name}`} className="w-auto max-w-full py-1 text-xs">
        {available.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      <select name="teamRole" aria-label={`Papel de ${user.name} na nova equipe`} defaultValue="MEMBER" className="w-auto py-1 text-xs">
        {teamRoles.map((r) => <option key={r} value={r}>{teamRoleLabel[r]}</option>)}
      </select>
      <button className="btn-ghost px-3 py-1 text-xs"><Plus className="h-3.5 w-3.5" /> Adicionar à equipe</button>
    </form>
  )
}
