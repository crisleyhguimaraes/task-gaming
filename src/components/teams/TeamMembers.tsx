import { Link } from '@tanstack/react-router'
import { teamRoleLabel } from '#/components/users/model'
import type { TeamRole } from '#/lib/access'

type Member = { userId: string; name: string; role: TeamRole; banned: boolean }

export function TeamMembers({ members, canManagePeople }: { members: ReadonlyArray<Member>; canManagePeople: boolean }) {
  return (
    <section aria-labelledby="team-members" className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="team-members" className="text-sm font-semibold text-neutral-200">Membros</h2>
        {canManagePeople && <Link to="/settings/users" className="text-xs text-neutral-400 underline hover:text-neutral-50">Gerenciar pessoas</Link>}
      </div>
      <ul className="divide-y divide-neutral-800">
        {members.map((m) => (
          <li key={m.userId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span className="font-medium">{m.name}{m.banned && <span className="ml-2 text-xs text-amber-400">desativado</span>}</span>
            <span className="text-xs text-neutral-400">{teamRoleLabel[m.role]}</span>
          </li>
        ))}
        {members.length === 0 && <li className="py-2 text-sm text-neutral-500">Nenhum membro ainda.</li>}
      </ul>
    </section>
  )
}
