import { Link } from '@tanstack/react-router'
import { Trophy } from 'lucide-react'
import { fmtClock } from '#/lib/format'
import type { listChallengesFor } from '#/server/challenges.core'
import { Avatar } from './Avatar'

export type ChallengeItem = Awaited<ReturnType<typeof listChallengesFor>>[number]

export function ChallengeCard({ c }: { c: ChallengeItem }) {
  return (
    <Link to="/challenges/$challengeId" params={{ challengeId: c.id }} className="card flex items-center gap-3 hover:bg-neutral-800/60">
      <span className="tile-gold h-10 w-10"><Trophy className="h-5 w-5" /></span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{c.title}</div>
        <div className="text-xs text-neutral-400">meta {fmtClock(c.estimatedSeconds)} · {c.basePoints} pts</div>
      </div>
      {c.record ? (
        <div className="flex items-center gap-2 text-right">
          <div>
            <div className="text-sm font-bold text-xp-400 tabular-nums">{fmtClock(c.record.best ?? 0)}</div>
            <div className="text-xs text-neutral-400">{c.record.holder.split(' ')[0]}</div>
          </div>
          <Avatar name={c.record.holder} size="sm" />
        </div>
      ) : (
        <span className="text-xs text-neutral-500">sem recorde</span>
      )}
    </Link>
  )
}
