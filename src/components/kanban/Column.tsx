import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { BoardTask } from './Board'
import { KanbanCard } from './Card'

export function KanbanColumn({ id, title, dot, tasks }: { id: string; title: string; dot: string; tasks: Array<BoardTask> }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <section className={`flex h-full min-w-[240px] flex-1 flex-col rounded-2xl border bg-neutral-950/60 p-2 ${isOver ? 'border-brand-ring' : 'border-neutral-800'}`}>
      <header className="flex items-center justify-between gap-2 rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2">
        <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
          <span className="truncate">{title}</span>
        </h2>
        <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-xs font-medium text-neutral-300 tabular-nums">{tasks.length}</span>
      </header>
      <div ref={setNodeRef} className="mt-2 min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5">
        {tasks.length === 0 && <p className="px-2 py-6 text-center text-xs text-neutral-500">Nenhuma tarefa aqui</p>}
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((t) => <KanbanCard key={t.id} task={t} />)}
        </SortableContext>
      </div>
    </section>
  )
}
