import type { LeadStatus } from '#/db/schema'
import { leadStatusLabels } from '#/lib/leads'

const tone: Record<LeadStatus, string> = {
  new: 'border-neutral-700 bg-neutral-800/40 text-neutral-300',
  contacted: 'border-amber-800/40 bg-amber-950/30 text-amber-300',
  qualified: 'border-xp-800/40 bg-xp-950/30 text-xp-400',
  disqualified: 'border-rose-900/50 bg-rose-950/30 text-rose-300',
}

export function StatusBadge({ status }: { status: LeadStatus }) {
  return <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${tone[status]}`}>{leadStatusLabels[status]}</span>
}
