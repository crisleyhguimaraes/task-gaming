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
    <section className={`flex h-full min-w-[240px] flex-1 flex-col rounded-2xl border bg-neutral-950/60 p-2 ${isOver ? 'border-brand-ring' : 'border-neutral-800'}`}>
      <header className="flex items-center justify-between gap-2 rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2">
        <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          <span className={`h-2 w-2 shrink-0 rounded-full ${KIND_DOT[stage.kind]}`} />
          <span className="truncate">{stage.name}</span>
        </h2>
        <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-xs font-medium text-neutral-300 tabular-nums">{cards.length}</span>
      </header>
      <div className="px-1 pt-2 pb-2 text-xs text-neutral-500 tabular-nums">
        {formatCents(amountCents)}
        {stage.kind === 'open' && <> · pond. {formatCents(weightedAmount(amountCents, stage.probability))}</>}
      </div>
      <div ref={setNodeRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5">
        {cards.length === 0 && <p className="px-2 py-6 text-center text-xs text-neutral-500">Nenhum negócio nesta etapa</p>}
        <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {cards.map((c) => (
            <OpportunityCard key={c.id} card={c} stageKind={stage.kind} />
          ))}
        </SortableContext>
      </div>
    </section>
  )
}
