import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Link } from '@tanstack/react-router'
import { CalendarDays, Flame, Lock } from 'lucide-react'
import type { BoardTask } from './Board'
import { Avatar } from '../Avatar'

export const PRIORITY_BORDER: Record<BoardTask['priority'], string> = {
  low: 'border-l-neutral-600',
  medium: 'border-l-sky-500',
  high: 'border-l-amber-400',
  urgent: 'border-l-rose-500',
}
export const PRIORITY_LABEL: Record<BoardTask['priority'], string> = { low: 'Baixa', medium: 'Média', high: 'Alta', urgent: 'Urgente' }

export function KanbanCard({ task, overlay = false }: { task: BoardTask; overlay?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id, data: { task } })
  const style: React.CSSProperties = { transform: CSS.Translate.toString(transform), transition, opacity: isDragging && !overlay ? 0.3 : 1 }
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`group rounded-xl border border-neutral-800 border-l-4 bg-neutral-900 p-3 shadow-sm hover:border-neutral-700 active:cursor-grabbing ${PRIORITY_BORDER[task.priority]} ${overlay ? 'rotate-2 shadow-2xl' : 'cursor-grab'}`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 rounded-md border border-xp-800/40 bg-xp-950/40 px-1.5 py-0.5 text-[11px] font-semibold text-xp-400">
          <Flame className="h-3 w-3 fill-xp-400" /> {task.basePoints}
        </span>
        {task.isBlocked && (
          <span className="flex items-center gap-1 rounded-md border border-rose-900/50 bg-rose-950/40 px-1.5 py-0.5 text-[10px] font-medium text-rose-400">
            <Lock className="h-3 w-3" /> Bloqueada
          </span>
        )}
      </div>
      <Link to="/tasks/$taskId" params={{ taskId: task.id }} className="block text-sm leading-snug font-medium text-neutral-100 hover:underline">
        {task.title}
      </Link>
      <div className="mt-2.5 flex items-center justify-between border-t border-neutral-800/60 pt-2 text-[11px] text-neutral-400">
        {task.assigneeName ? (
          <span className="flex items-center gap-1.5">
            <Avatar name={task.assigneeName} size="sm" />
            <span className="max-w-[110px] truncate">{task.assigneeName}</span>
          </span>
        ) : (
          <span className="italic text-neutral-500">Pool</span>
        )}
        <span className="flex items-center gap-2">
          {task.dueDate && (
            <span className="flex items-center gap-1"><CalendarDays className="h-3 w-3" /> {task.dueDate.slice(5).replace('-', '/')}</span>
          )}
          {task.status === 'in_progress' && (
            <span className="flex items-center gap-1 text-emerald-400"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> ativa</span>
          )}
        </span>
      </div>
    </div>
  )
}
