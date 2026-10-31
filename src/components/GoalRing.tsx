import { Coffee } from 'lucide-react'
import { Ring } from './Ring'

/** `goal === null` é dia livre: a meta de hoje é nenhuma, então não há porcentagem para mostrar. */
export function GoalRing({ goal, points }: { goal: number | null; points: number }) {
  if (goal === null) {
    return (
      <div className="flex items-center gap-4 lg:flex-col lg:items-center lg:text-center">
        <Ring pct={0} size={120} stroke={10} className="text-neutral-700">
          <Coffee aria-hidden className="h-6 w-6 text-neutral-400" />
          <span className="text-sm font-semibold text-neutral-300">Dia livre</span>
        </Ring>
        <div className="text-lg font-semibold">Hoje não tem meta · {points} pts</div>
      </div>
    )
  }
  const pct = Math.min(100, Math.round((points / goal) * 100))
  return (
    <div className="flex items-center gap-4 lg:flex-col lg:items-center lg:text-center">
      <Ring pct={pct} size={120} stroke={10} className="text-brand-ring">
        <span className="text-xl font-bold">{pct}%</span>
        <span className="text-xs text-neutral-400">da meta</span>
      </Ring>
      <div>
        <div className="text-sm text-neutral-400">Hoje</div>
        <div className="text-lg font-semibold">{points} / {goal} pts</div>
      </div>
    </div>
  )
}
