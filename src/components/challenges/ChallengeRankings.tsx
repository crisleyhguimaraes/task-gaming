import * as React from 'react'
import { Avatar } from '#/components/Avatar'
import { fmtClock } from '#/lib/format'
import { countAttempts } from '#/lib/challenge'
import type { challengeDetailFor } from '#/server/challenges.core'

type Detail = Awaited<ReturnType<typeof challengeDetailFor>>

type Props = { ranking: Detail['ranking']; teamRanking: Detail['teamRanking']; meId: string; myTeamIds: ReadonlyArray<string> }

const TABS = [
  ['people', 'Pessoas'],
  ['teams', 'Equipes'],
] as const

export function ChallengeRankings({ ranking, teamRanking, meId, myTeamIds }: Props) {
  const [tab, setTab] = React.useState<(typeof TABS)[number][0]>('people')
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-neutral-300">Ranking</h2>
        <div className="flex gap-1 rounded-xl border border-neutral-800 p-1 text-xs font-medium">
          {TABS.map(([id, label]) => (
            <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)} className={`rounded-lg px-3 py-1 ${tab === id ? 'bg-neutral-800 text-neutral-50' : 'text-neutral-400'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {tab === 'people' ? <PeopleRanking ranking={ranking} meId={meId} /> : <TeamsRanking teamRanking={teamRanking} myTeamIds={myTeamIds} />}
    </section>
  )
}

const rowClass = (highlight: boolean) => `flex items-center justify-between gap-3 px-4 py-3 ${highlight ? 'bg-xp-950/10' : ''}`
const positionClass = (index: number) => `w-5 shrink-0 text-center text-sm font-bold ${index === 0 ? 'text-xp-400' : 'text-neutral-500'}`

function PeopleRanking({ ranking, meId }: Pick<Props, 'ranking' | 'meId'>) {
  return (
    <ol className="divide-y divide-neutral-800 rounded-2xl border border-neutral-800">
      {ranking.map((r, i) => (
        <li key={r.userId} className={rowClass(r.userId === meId)}>
          <div className="flex min-w-0 items-center gap-3">
            <span className={positionClass(i)}>{i + 1}</span>
            <Avatar name={r.name} />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{r.name}</div>
              <div className="truncate text-[11px] text-neutral-500">{r.teamName} · {countAttempts(r.attempts)} · {r.points} pts</div>
            </div>
          </div>
          <span className="text-sm font-bold tabular-nums">{fmtClock(r.best ?? 0)}</span>
        </li>
      ))}
      {ranking.length === 0 && <li className="px-4 py-6 text-center text-sm text-neutral-500">Sem tempos válidos ainda.</li>}
    </ol>
  )
}

function TeamsRanking({ teamRanking, myTeamIds }: Pick<Props, 'teamRanking' | 'myTeamIds'>) {
  return (
    <>
      <ol className="divide-y divide-neutral-800 rounded-2xl border border-neutral-800">
        {teamRanking.map((r, i) => (
          <li key={r.teamId} className={rowClass(myTeamIds.includes(r.teamId))}>
            <div className="flex min-w-0 items-center gap-3">
              <span className={positionClass(i)}>{i + 1}</span>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{r.teamName}</div>
                <div className="truncate text-[11px] text-neutral-500">
                  {r.participants} participante{r.participants === 1 ? '' : 's'} · {r.participationPct}% da equipe
                </div>
              </div>
            </div>
            <span className="text-sm font-bold tabular-nums">{fmtClock(r.averageSeconds)}</span>
          </li>
        ))}
        {teamRanking.length === 0 && <li className="px-4 py-6 text-center text-sm text-neutral-500">Nenhuma equipe com tempo válido ainda.</li>}
      </ol>
      <p className="text-xs text-neutral-500">
        O tempo da equipe é a média do melhor tempo válido de cada participante. Empate: mais participantes, depois quem fechou o resultado antes. A participação é a parte dos membros de hoje que já tentou.
      </p>
    </>
  )
}
