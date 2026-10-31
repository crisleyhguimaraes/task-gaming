import type { TeamRef } from '#/components/teams/model'

type Props = { ownerName: string; tenantWide: boolean; sharedTeams: ReadonlyArray<TeamRef> }

const chip = 'max-w-full truncate rounded-full border border-neutral-700/60 bg-neutral-800/60 px-2.5 py-0.5 text-xs font-medium'

export function ChallengeTeams({ ownerName, tenantWide, sharedTeams }: Props) {
  return (
    <ul aria-label="Equipes que competem" className="flex flex-wrap items-center gap-1.5">
      <li className="max-w-full truncate rounded-full border border-xp-800/40 bg-xp-950/30 px-2.5 py-0.5 text-xs font-semibold text-xp-400">
        <span className="font-normal text-neutral-400">Dona </span>{ownerName}
      </li>
      {tenantWide ? <li className={chip}>Toda a empresa</li> : sharedTeams.map((t) => <li key={t.id} className={chip}>{t.name}</li>)}
    </ul>
  )
}
