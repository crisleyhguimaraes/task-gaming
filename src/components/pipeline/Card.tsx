import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Link } from '@tanstack/react-router'
import { CalendarDays } from 'lucide-react'
import type { StageKind } from '#/db/schema'
import { DEAL_STATUS_LABEL, dealStatus, localToday } from '#/lib/deal-status'
import type { DealStatus } from '#/lib/deal-status'
import { formatCents } from '#/lib/pipeline'
import { Avatar } from '../Avatar'
import type { OpportunityCardData } from './Board'

const STATUS_CLS: Record<DealStatus, string> = {
  overdue: 'border-rose-900/50 bg-rose-950/40 text-rose-400',
  soon: 'border-amber-800/50 bg-amber-950/40 text-amber-300',
  on_track: 'border-brand-ring/30 bg-brand-soft text-brand-ink',
}

const formatDate = (iso: string) => `${iso.slice(8)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

export function OpportunityCard({ card, stageKind, overlay = false }: { card: OpportunityCardData; stageKind: StageKind; overlay?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id, disabled: !card.canWrite })
  const style: React.CSSProperties = { transform: CSS.Translate.toString(transform), transition, opacity: isDragging && !overlay ? 0.3 : 1 }
  const status = dealStatus(card.expectedCloseDate, stageKind, localToday())
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`rounded-xl border border-neutral-800 bg-neutral-900 p-3 shadow-[0_1px_2px_rgb(20_22_50/0.04)] hover:border-neutral-700 ${overlay ? 'rotate-2 shadow-2xl' : ''} ${card.canWrite ? 'cursor-grab active:cursor-grabbing' : ''}`}
    >
      <Link to="/opportunities/$opportunityId" params={{ opportunityId: card.id }} className="block text-sm leading-snug font-semibold text-neutral-50 hover:underline">
        {card.title}
      </Link>
      <div className="mt-0.5 truncate text-xs text-neutral-400">{card.leadName}</div>
      <div className="mt-3 flex items-center gap-3 text-xs tabular-nums">
        <span className="font-semibold text-neutral-50">{formatCents(card.amountCents)}</span>
        {card.expectedCloseDate && (
          <span className="flex items-center gap-1 text-neutral-400">
            <CalendarDays className="h-3.5 w-3.5" /> {formatDate(card.expectedCloseDate)}
          </span>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-neutral-800 pt-2.5">
        {card.ownerName ? (
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-neutral-300">
            <Avatar name={card.ownerName} size="sm" />
            <span className="truncate">{card.ownerName}</span>
          </span>
        ) : (
          <span className="text-xs text-neutral-500 italic">Sem dono</span>
        )}
        {status && <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_CLS[status]}`}>{DEAL_STATUS_LABEL[status]}</span>}
      </div>
    </div>
  )
}
