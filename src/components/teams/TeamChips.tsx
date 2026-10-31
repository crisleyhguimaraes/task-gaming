type Props = { teams: ReadonlyArray<{ id: string; name: string }>; emptyText: string }

export function TeamChips({ teams, emptyText }: Props) {
  if (teams.length === 0) return <p className="text-xs text-neutral-500">{emptyText}</p>
  return (
    <ul aria-label="Equipes vinculadas" className="flex flex-wrap gap-1.5">
      {teams.map((t) => (
        <li key={t.id} className="max-w-full truncate rounded-full border border-neutral-700/60 bg-neutral-800/60 px-2.5 py-0.5 text-xs font-medium">{t.name}</li>
      ))}
    </ul>
  )
}
