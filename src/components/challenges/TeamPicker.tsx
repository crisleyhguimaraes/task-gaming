type Team = { id: string; name: string }

type Props = {
  legend: string
  teams: ReadonlyArray<Team>
  picked: ReadonlyArray<string>
  onChange: (picked: Array<string>) => void
}

export function TeamPicker({ legend, teams, picked, onChange }: Props) {
  const toggle = (teamId: string) => onChange(picked.includes(teamId) ? picked.filter((id) => id !== teamId) : [...picked, teamId])
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-xs font-medium text-neutral-400">{legend}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {teams.map((team) => (
          <label key={team.id} className="flex items-center gap-2 text-sm text-neutral-200">
            <input type="checkbox" checked={picked.includes(team.id)} onChange={() => toggle(team.id)} className="h-4 w-4 p-0 accent-xp-400" />
            {team.name}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
