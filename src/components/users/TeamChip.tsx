import { X } from 'lucide-react'
import type { TeamRole } from '#/lib/access'
import { teamRoles } from '#/lib/access'
import type { Membership } from './model'
import { teamRoleLabel, teamRoleOf } from './model'

type Props = {
  link: Membership
  personName: string
  onChangeRole?: (role: TeamRole) => void
  onRemove?: () => void
}

export function TeamChip({ link, personName, onChangeRole, onRemove }: Props) {
  return (
    <li className={`inline-flex max-w-full items-center gap-1 rounded-full border border-neutral-700/60 bg-neutral-800/60 py-0.5 pl-2.5 text-xs ${onRemove ? 'pr-1' : 'pr-2.5'}`}>
      <span className="truncate font-medium">{link.teamName}</span>
      {onChangeRole ? (
        <select
          aria-label={`Papel de ${personName} em ${link.teamName}`}
          value={link.role}
          onChange={(e) => onChangeRole(teamRoleOf(e.target.value))}
          className="w-auto rounded-full px-1.5 py-0.5 text-xs"
        >
          {teamRoles.map((r) => <option key={r} value={r}>{teamRoleLabel[r]}</option>)}
        </select>
      ) : (
        <span className="text-neutral-400">· {teamRoleLabel[link.role]}</span>
      )}
      {onRemove ? (
        <button type="button" onClick={onRemove} aria-label={`Remover ${personName} da equipe ${link.teamName}`} className="rounded-full p-1 text-neutral-500 hover:bg-neutral-700 hover:text-rose-400">
          <X className="h-3 w-3" />
        </button>
      ) : null}
    </li>
  )
}
