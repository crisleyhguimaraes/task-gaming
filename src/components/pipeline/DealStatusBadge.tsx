import type { StageKind } from '#/db/schema'
import { DEAL_STATUS_LABEL, dealStatus, localToday } from '#/lib/deal-status'
import type { DealStatus } from '#/lib/deal-status'

const STATUS_CLS: Record<DealStatus, string> = {
  overdue: 'border-rose-900/50 bg-rose-950/40 text-rose-400',
  soon: 'border-amber-800/50 bg-amber-950/40 text-amber-300',
  on_track: 'border-brand-ring/30 bg-brand-soft text-brand-ink',
}

export function DealStatusBadge({ expectedCloseDate, stageKind }: { expectedCloseDate: string | null; stageKind: StageKind }) {
  const status = dealStatus(expectedCloseDate, stageKind, localToday())
  if (!status) return null
  return <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${STATUS_CLS[status]}`}>{DEAL_STATUS_LABEL[status]}</span>
}
