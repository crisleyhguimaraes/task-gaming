import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { BoardTask } from './Board'
import { KanbanCard } from './Card'

export function KanbanColumn({ id, title, tasks }: { id: string; title: string; tasks: Array<BoardTask> }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div className={`flex min-h-[60vh] w-[250px] flex-1 shrink-0 flex-col rounded-2xl border bg-neutral-900/60 p-2.5 ${isOver ? 'border-xp-500/40' : 'border-neutral-800/60'}`}>
      <div className="flex items-center gap-2 px-1 pb-2.5">
        <h2 className="text-sm font-semibold text-neutral-300">{title}</h2>
        <span className="rounded-full border border-neutral-800 bg-neutral-900 px-2 py-0.5 text-[11px] text-neutral-400">{tasks.length}</span>
      </div>
      <div ref={setNodeRef} className="flex-1 space-y-2 overflow-y-auto">
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((t) => <KanbanCard key={t.id} task={t} />)}
        </SortableContext>
      </div>
    </div>
  )
}
