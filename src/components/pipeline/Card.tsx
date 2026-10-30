import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Link } from '@tanstack/react-router'
import { CalendarDays } from 'lucide-react'
import { formatCents } from '#/lib/pipeline'
import { Avatar } from '../Avatar'
import type { OpportunityCardData } from './Board'

export function OpportunityCard({ card, overlay = false }: { card: OpportunityCardData; overlay?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id, disabled: !card.canWrite })
  const style: React.CSSProperties = { transform: CSS.Translate.toString(transform), transition, opacity: isDragging && !overlay ? 0.3 : 1 }
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`rounded-xl border border-neutral-800 bg-neutral-900 p-3 shadow-sm hover:border-neutral-700 ${overlay ? 'rotate-2 shadow-2xl' : ''} ${card.canWrite ? 'cursor-grab active:cursor-grabbing' : ''}`}
    >
      <Link to="/opportunities/$opportunityId" params={{ opportunityId: card.id }} className="block text-sm leading-snug font-medium text-neutral-100 hover:underline">
        {card.title}
      </Link>
      <div className="mt-0.5 truncate text-xs text-neutral-500">{card.leadName}</div>
      <div className="mt-2 text-sm font-semibold text-xp-400">{formatCents(card.amountCents)}</div>
      <div className="mt-2.5 flex items-center justify-between border-t border-neutral-800/60 pt-2 text-[11px] text-neutral-400">
        {card.ownerName ? (
          <span className="flex items-center gap-1.5">
            <Avatar name={card.ownerName} size="sm" />
            <span className="max-w-[100px] truncate">{card.ownerName}</span>
          </span>
        ) : (
          <span className="italic text-neutral-500">Sem dono</span>
        )}
        {card.expectedCloseDate && (
          <span className="flex items-center gap-1">
            <CalendarDays className="h-3 w-3" /> {card.expectedCloseDate.slice(5).replace('-', '/')}
          </span>
        )}
      </div>
    </div>
  )
}
