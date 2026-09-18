import { Crown } from 'lucide-react'
import { LEVELS } from '#/server/levels'

/** Trilha horizontal de níveis (ref: "Your progress"). Marcos alcançados acesos; o atual pulsa. */
export function LevelTrack({ points }: { points: number }) {
  const reached = LEVELS.filter((l) => points >= l.min).length
  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <ol className="relative flex min-w-[640px] items-start justify-between pt-2">
        <div className="absolute top-[18px] right-6 left-6 h-1 rounded-full bg-neutral-800" />
        <div
          className="absolute top-[18px] left-6 h-1 rounded-full bg-gradient-to-r from-xp-600 to-xp-400 transition-[width] duration-1000"
          style={{ width: `calc((100% - 3rem) * ${reached <= 1 ? 0 : (reached - 1) / (LEVELS.length - 1)})` }}
        />
        {LEVELS.map((l, i) => {
          const done = i < reached
          const current = i === reached - 1
          return (
            <li key={l.name} className="relative flex w-24 flex-col items-center text-center">
              <span
                className={`z-10 flex h-9 w-9 items-center justify-center rounded-full border-4 border-neutral-900 ${
                  done ? 'bg-xp-400 text-[#0b1a10]' : 'bg-neutral-800 text-neutral-500'
                } ${current ? 'shadow-[0_0_0_6px_rgba(62,226,122,0.2)]' : ''}`}
              >
                {i === LEVELS.length - 1 ? <Crown className="h-4 w-4" /> : <span className="text-xs font-bold">{i + 1}</span>}
              </span>
              <span className={`mt-2 text-xs ${done ? 'text-neutral-300' : 'text-neutral-500'}`}>{l.min} pts</span>
              <span className={`text-xs font-semibold ${current ? 'text-xp-400' : done ? 'text-neutral-200' : 'text-neutral-500'}`}>{l.name}</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
