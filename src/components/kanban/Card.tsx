import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Link } from '@tanstack/react-router'
import { CalendarDays, Flame, Lock } from 'lucide-react'
import type { BoardTask } from './Board'
import { Avatar } from '../Avatar'

export const PRIORITY_LABEL: Record<BoardTask['priority'], string> = { low: 'Baixa', medium: 'Média', high: 'Alta', urgent: 'Urgente' }

const PRIORITY_BADGE: Record<BoardTask['priority'], string> = {
  low: 'border-neutral-700 bg-neutral-800 text-neutral-300',
  medium: 'border-amber-800/50 bg-amber-950/40 text-amber-300',
  high: 'border-rose-900/50 bg-rose-950/40 text-rose-400',
  urgent: 'border-rose-600 bg-rose-600 text-white',
}

const formatDue = (iso: string) => `${iso.slice(8)}/${iso.slice(5, 7)}`

export function KanbanCard({ task, overlay = false }: { task: BoardTask; overlay?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id, data: { task } })
  const style: React.CSSProperties = { transform: CSS.Translate.toString(transform), transition, opacity: isDragging && !overlay ? 0.3 : 1 }
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`rounded-xl border border-neutral-800 bg-neutral-900 p-3 shadow-[0_1px_2px_rgb(20_22_50/0.04)] hover:border-neutral-700 active:cursor-grabbing ${overlay ? 'rotate-2 shadow-2xl' : 'cursor-grab'}`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 rounded-md border border-xp-800/40 bg-xp-950/40 px-1.5 py-0.5 text-[11px] font-semibold text-xp-400">
          <Flame className="h-3 w-3 fill-xp-400" /> {task.basePoints}
        </span>
        {task.isBlocked && (
          <span className="flex items-center gap-1 rounded-md border border-rose-900/50 bg-rose-950/40 px-1.5 py-0.5 text-[11px] font-medium text-rose-400">
            <Lock className="h-3 w-3" /> Bloqueada
          </span>
        )}
      </div>
      <Link to="/tasks/$taskId" params={{ taskId: task.id }} className="block text-sm leading-snug font-semibold text-neutral-50 hover:underline">
        {task.title}
      </Link>
      {(task.dueDate || task.status === 'in_progress') && (
        <div className="mt-2 flex items-center gap-3 text-xs tabular-nums text-neutral-400">
          {task.dueDate && (
            <span className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" /> {formatDue(task.dueDate)}</span>
          )}
          {task.status === 'in_progress' && (
            <span className="flex items-center gap-1 text-xp-400"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-xp-400" /> ativa</span>
          )}
        </div>
      )}
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-neutral-800 pt-2.5">
        {task.assigneeName ? (
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-neutral-300">
            <Avatar name={task.assigneeName} size="sm" />
            <span className="truncate">{task.assigneeName}</span>
          </span>
        ) : (
          <span className="text-xs text-neutral-500 italic">Pool</span>
        )}
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${PRIORITY_BADGE[task.priority]}`}>{PRIORITY_LABEL[task.priority]}</span>
      </div>
    </div>
  )
}
