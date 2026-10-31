import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { weightedAmount } from '#/lib/funnel'
import { formatCents } from '#/lib/pipeline'
import type { OpportunityCardData, StageColumn } from './Board'
import { OpportunityCard } from './Card'

const KIND_DOT = { open: 'bg-brand-ring', won: 'bg-xp-400', lost: 'bg-rose-400' } as const

export function PipelineColumn({ stage, cards }: { stage: StageColumn; cards: Array<OpportunityCardData> }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id })
  const amountCents = cards.reduce((sum, c) => sum + c.amountCents, 0)
  return (
    <section className={`flex h-full min-w-[280px] flex-1 flex-col rounded-2xl border bg-neutral-950/60 p-2 ${isOver ? 'border-brand-ring' : 'border-neutral-800'}`}>
      <header className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <span className={`h-2 w-2 rounded-full ${KIND_DOT[stage.kind]}`} />
          {stage.name}
        </h2>
        <span className="text-xs text-neutral-400 tabular-nums">
          {cards.length} {cards.length === 1 ? 'negócio' : 'negócios'} · {formatCents(amountCents)}
        </span>
      </header>
      {stage.kind === 'open' && <div className="mb-2 px-1 text-xs text-neutral-500">Ponderado {formatCents(weightedAmount(amountCents, stage.probability))}</div>}
      <div ref={setNodeRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5">
        <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {cards.map((c) => (
            <OpportunityCard key={c.id} card={c} stageKind={stage.kind} />
          ))}
        </SortableContext>
      </div>
    </section>
  )
}
