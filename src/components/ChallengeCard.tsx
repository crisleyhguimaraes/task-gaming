import { Link } from '@tanstack/react-router'
import { Trophy, Users } from 'lucide-react'
import { sharingLabel } from '#/lib/challenge-sharing'
import { fmtClock } from '#/lib/format'
import type { listChallengesFor } from '#/server/challenges.core'
import { Avatar } from './Avatar'

export type ChallengeItem = Awaited<ReturnType<typeof listChallengesFor>>[number]

export function ChallengeCard({ c }: { c: ChallengeItem }) {
  const sharing = sharingLabel(c)
  return (
    <Link to="/challenges/$challengeId" params={{ challengeId: c.id }} className="card flex items-center gap-3 hover:border-neutral-700">
      <span className="tile-gold h-10 w-10"><Trophy className="h-5 w-5" /></span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{c.title}</div>
        <div className="truncate text-xs text-neutral-400">{c.teamName} · meta {fmtClock(c.estimatedSeconds)} · {c.basePoints} pts</div>
        {sharing && (
          <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-brand-ring/30 bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand-ink">
            <Users className="h-3 w-3" /> {sharing}
          </span>
        )}
      </div>
      {c.record ? (
        <div className="flex max-w-[40%] shrink-0 items-center gap-2 text-right">
          <div className="min-w-0">
            <div className="text-sm font-bold text-xp-400 tabular-nums">{fmtClock(c.record.best ?? 0)}</div>
            <div className="truncate text-xs text-neutral-400">{c.record.holder.split(' ')[0]}</div>
            <div className="truncate text-[11px] text-neutral-500">{c.record.holderTeam}</div>
          </div>
          <Avatar name={c.record.holder} size="sm" />
        </div>
      ) : (
        <span className="shrink-0 text-xs text-neutral-500">sem recorde</span>
      )}
    </Link>
  )
}
