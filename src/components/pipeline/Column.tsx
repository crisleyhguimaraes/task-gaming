import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { weightedAmount } from '#/lib/funnel'
import { formatCents } from '#/lib/pipeline'
import type { OpportunityCardData, StageColumn } from './Board'
import { OpportunityCard } from './Card'

const KIND_ACCENT = { open: 'text-neutral-300', won: 'text-emerald-400', lost: 'text-rose-400' } as const

export function PipelineColumn({ stage, cards }: { stage: StageColumn; cards: Array<OpportunityCardData> }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id })
  const amountCents = cards.reduce((sum, c) => sum + c.amountCents, 0)
  return (
    <div className={`flex min-h-[55vh] w-[260px] flex-1 shrink-0 flex-col rounded-2xl border bg-neutral-900/60 p-2.5 ${isOver ? 'border-xp-500/40' : 'border-neutral-800/60'}`}>
      <div className="px-1 pb-2.5">
        <div className="flex items-center gap-2">
          <h2 className={`text-sm font-semibold ${KIND_ACCENT[stage.kind]}`}>{stage.name}</h2>
          <span className="rounded-full border border-neutral-800 bg-neutral-900 px-2 py-0.5 text-[11px] text-neutral-400">{cards.length}</span>
        </div>
        <div className="mt-1 text-xs text-neutral-400">
          {formatCents(amountCents)}
          {stage.kind === 'open' && <span className="text-neutral-500"> · pond. {formatCents(weightedAmount(amountCents, stage.probability))}</span>}
        </div>
      </div>
      <div ref={setNodeRef} className="flex-1 space-y-2 overflow-y-auto">
        <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {cards.map((c) => <OpportunityCard key={c.id} card={c} />)}
        </SortableContext>
      </div>
    </div>
  )
}
