import type { LeadStatus } from '#/db/schema'
import { leadStatusLabels } from '#/lib/leads'

const tone: Record<LeadStatus, string> = {
  new: 'border-brand-ring/30 bg-brand-soft text-brand-ink',
  contacted: 'border-amber-800/50 bg-amber-950/40 text-amber-300',
  qualified: 'border-xp-800/40 bg-xp-950/40 text-xp-400',
  disqualified: 'border-rose-900/50 bg-rose-950/40 text-rose-400',
}

export function StatusBadge({ status }: { status: LeadStatus }) {
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${tone[status]}`}>{leadStatusLabels[status]}</span>
}
