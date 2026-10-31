import type { TeamRef } from './model'

type Props = {
  legend: string
  hint?: string
  teams: ReadonlyArray<TeamRef>
  selected: ReadonlyArray<TeamRef>
  otherOwners?: ReadonlyMap<string, string>
}

/** Caixas `teamIds` lidas via FormData. Desmarcadas por padrão, menos as de `selected`; `otherOwners` avisa o que a equipe usa hoje. */
export function TeamCheckboxes({ legend, hint, teams, selected, otherOwners }: Props) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-xs font-medium text-neutral-400">{legend}</legend>
      {hint && <p className="text-xs text-neutral-500">{hint}</p>}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {teams.map((team) => (
          <label key={team.id} className="flex items-center gap-2 text-sm text-neutral-200">
            <input type="checkbox" name="teamIds" value={team.id} defaultChecked={selected.some((s) => s.id === team.id)} className="h-4 w-4 p-0 accent-xp-400" />
            {team.name}
            {otherOwners?.has(team.id) && <span className="text-xs text-amber-400">hoje usa {otherOwners.get(team.id)}</span>}
          </label>
        ))}
        {teams.length === 0 && <p className="text-sm text-neutral-500">Nenhuma equipe disponível.</p>}
      </div>
    </fieldset>
  )
}
