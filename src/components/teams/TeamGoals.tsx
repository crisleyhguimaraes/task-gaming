import { Link } from '@tanstack/react-router'
import { WeekdayChips } from '../goals/WeekdayPicker'

type Props = {
  goal: { name: string; targetPoints: number; activeDays: ReadonlyArray<number>; isDefault: boolean }
  scoringRule: { name: string; isDefault: boolean }
  canConfigure: boolean
}

const itemName = ({ name, isDefault }: { name: string; isDefault: boolean }) => (isDefault ? `padrão do tenant: ${name}` : name)

/** Só leitura: o vínculo da equipe com a meta e a pontuação se edita em Metas e pontuação. */
export function TeamGoals({ goal, scoringRule, canConfigure }: Props) {
  return (
    <section aria-labelledby="team-goals" className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="team-goals" className="text-sm font-semibold text-neutral-200">Metas e pontuação</h2>
        {canConfigure && <Link to="/settings/goals" className="text-xs text-neutral-400 underline hover:text-neutral-50">Configurar metas e pontuação</Link>}
      </div>
      <dl className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <dt className="text-xs text-neutral-500">Meta em uso</dt>
          <dd className="space-y-1.5 text-sm">
            <div className="font-medium">{itemName(goal)}</div>
            <div className="text-neutral-400">{goal.targetPoints} pts por dia</div>
            <WeekdayChips days={goal.activeDays} />
          </dd>
        </div>
        <div className="space-y-1.5">
          <dt className="text-xs text-neutral-500">Pontuação em uso</dt>
          <dd className="text-sm font-medium">{itemName(scoringRule)}</dd>
        </div>
      </dl>
    </section>
  )
}
