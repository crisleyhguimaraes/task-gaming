import { DndContext, DragOverlay, PointerSensor, closestCorners, useSensor, useSensors } from '@dnd-kit/core'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import * as React from 'react'
import { calculateNewOrder } from '#/lib/order'
import type { TaskStatus } from '#/db/schema'
import type { listTasks } from '#/server/tasks'
import { KanbanCard } from './Card'
import { KanbanColumn } from './Column'

export type BoardTask = Awaited<ReturnType<typeof listTasks>>['tasks'][number]

export const COLUMNS: Array<{ id: TaskStatus; title: string; dot: string }> = [
  { id: 'pending', title: 'A fazer / Pool', dot: 'bg-neutral-500' },
  { id: 'in_progress', title: 'Em andamento', dot: 'bg-brand-ring' },
  { id: 'paused', title: 'Pausadas', dot: 'bg-amber-500' },
  { id: 'finished', title: 'Concluídas', dot: 'bg-xp-400' },
]

export type MovePayload = { task: BoardTask; toStatus: TaskStatus; sortOrder: number }

type Props = {
  tasks: Array<BoardTask>
  /** Retorna false se a transição foi recusada (o board recarrega). */
  onMove: (p: MovePayload) => Promise<boolean>
}

export function KanbanBoard({ tasks, onMove }: Props) {
  const [items, setItems] = React.useState(() => group(tasks))
  const [active, setActive] = React.useState<BoardTask | null>(null)
  React.useEffect(() => setItems(group(tasks)), [tasks])
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const find = (id: string) => tasks.find((t) => t.id === id)

  function onDragStart(e: DragStartEvent) {
    setActive(find(String(e.active.id)) ?? null)
  }

  async function onDragEnd(e: DragEndEvent) {
    setActive(null)
    const { active: a, over } = e
    if (!over) return
    const task = find(String(a.id))
    if (!task) return
    const overId = String(over.id)
    const toStatus = (COLUMNS.some((c) => c.id === overId) ? overId : find(overId)?.status) as TaskStatus | undefined
    if (!toStatus) return

    const from = items[task.status] ?? []
    const target = toStatus === task.status ? from : (items[toStatus] ?? [])
    const oldIdx = from.findIndex((t) => t.id === task.id)
    const overIdx = target.findIndex((t) => t.id === overId)
    let next: Array<BoardTask>
    let idx: number
    if (toStatus === task.status) {
      idx = overIdx === -1 ? from.length - 1 : overIdx
      next = arrayMove(from, oldIdx, idx)
    } else {
      idx = overIdx === -1 ? target.length : overIdx
      next = [...target.slice(0, idx), { ...task, status: toStatus }, ...target.slice(idx)]
    }
    const sortOrder = calculateNewOrder(next[idx - 1]?.sortOrder ?? null, next[idx + 1]?.sortOrder ?? null)
    next[idx] = { ...next[idx]!, sortOrder }

    // otimista
    setItems((prev) => ({
      ...prev,
      [task.status]: toStatus === task.status ? next : from.filter((t) => t.id !== task.id),
      [toStatus]: next,
    }))
    await onMove({ task, toStatus, sortOrder })
  }

  return (
    <DndContext id="task-board" sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
      <div className="flex h-[max(28rem,calc(100dvh-14rem))] gap-3 overflow-x-auto pb-2 select-none">
        {COLUMNS.map((c) => <KanbanColumn key={c.id} id={c.id} title={c.title} dot={c.dot} tasks={items[c.id] ?? []} />)}
      </div>
      <DragOverlay>{active ? <KanbanCard task={active} overlay /> : null}</DragOverlay>
    </DndContext>
  )
}

function group(tasks: Array<BoardTask>) {
  const g: Partial<Record<TaskStatus, Array<BoardTask>>> = {}
  for (const t of tasks) (g[t.status] ??= []).push(t)
  return g
}
