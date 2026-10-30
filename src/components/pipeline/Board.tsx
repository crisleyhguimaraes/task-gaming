import { DndContext, DragOverlay, PointerSensor, closestCorners, useSensor, useSensors } from '@dnd-kit/core'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import * as React from 'react'
import { calculateNewOrder } from '#/lib/order'
import type { listPipeline } from '#/server/pipeline'
import { OpportunityCard } from './Card'
import { PipelineColumn } from './Column'

export type StageColumn = Awaited<ReturnType<typeof listPipeline>>[number]
export type OpportunityCardData = StageColumn['opportunities'][number]
export type MovePayload = { card: OpportunityCardData; toStage: StageColumn; sortOrder: number }

type CardsByStage = Record<string, Array<OpportunityCardData>>

const groupByStage = (columns: Array<StageColumn>): CardsByStage => Object.fromEntries(columns.map((c) => [c.id, c.opportunities]))

export function PipelineBoard({ columns, onMove }: { columns: Array<StageColumn>; onMove: (p: MovePayload) => void }) {
  const [items, setItems] = React.useState(() => groupByStage(columns))
  const [active, setActive] = React.useState<OpportunityCardData | null>(null)
  React.useEffect(() => setItems(groupByStage(columns)), [columns])
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const stageIdOf = (cardId: string) => columns.find((c) => items[c.id]?.some((card) => card.id === cardId))?.id
  const findCard = (cardId: string) => Object.values(items).flat().find((c) => c.id === cardId)

  function onDragStart(e: DragStartEvent) {
    setActive(findCard(String(e.active.id)) ?? null)
  }

  function onDragEnd(e: DragEndEvent) {
    setActive(null)
    if (!e.over) return
    const card = findCard(String(e.active.id))
    const fromStageId = stageIdOf(String(e.active.id))
    const overId = String(e.over.id)
    const toStageId = columns.some((c) => c.id === overId) ? overId : stageIdOf(overId)
    const toStage = columns.find((c) => c.id === toStageId)
    if (!card || !fromStageId || !toStage) return

    const from = items[fromStageId] ?? []
    const target = items[toStage.id] ?? []
    const overIdx = target.findIndex((c) => c.id === overId)
    const sameStage = toStage.id === fromStageId
    const idx = overIdx === -1 ? (sameStage ? from.length - 1 : target.length) : overIdx
    const next = sameStage ? arrayMove(from, from.findIndex((c) => c.id === card.id), idx) : [...target.slice(0, idx), card, ...target.slice(idx)]
    const sortOrder = calculateNewOrder(next[idx - 1]?.sortOrder ?? null, next[idx + 1]?.sortOrder ?? null)
    next[idx] = { ...card, sortOrder }

    setItems((prev) => ({ ...prev, [fromStageId]: from.filter((c) => c.id !== card.id), [toStage.id]: next }))
    onMove({ card, toStage, sortOrder })
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-4 select-none">
        {columns.map((stage) => <PipelineColumn key={stage.id} stage={stage} cards={items[stage.id] ?? []} />)}
      </div>
      <DragOverlay>{active ? <OpportunityCard card={active} overlay /> : null}</DragOverlay>
    </DndContext>
  )
}
