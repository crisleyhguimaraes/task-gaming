import type { StageKind } from '#/db/schema'
import type { AuthCtx } from '#/server/roles'
import { canManage, canSee, fail } from '#/server/roles'
import type { AuditAction } from './audit'

const MIN_LOST_REASON_LENGTH = 3

type StageRef = { id: string; kind: StageKind }
export type Owned = { teamId: string; ownerId: string | null }

export type MoveOptions = { sortOrder?: number; lostReason?: string }

export type MovePlan =
  | { type: 'unchanged' }
  | { type: 'reorder'; sortOrder: number }
  | { type: 'change'; action: AuditAction; closedAt: Date | null; reopens: boolean }

function moveAction(from: StageRef, to: StageRef): AuditAction {
  if (to.kind === 'won') return 'opportunity.won'
  if (to.kind === 'lost') return 'opportunity.lost'
  return from.kind === 'open' ? 'opportunity.moved' : 'opportunity.reopened'
}

/** `reopens`: sair de uma etapa fechada, mesmo para outra fechada, exige `opportunity.reopen`. */
export function planMove(current: StageRef, target: StageRef, { sortOrder }: MoveOptions, now: Date): MovePlan {
  if (target.id === current.id) return sortOrder === undefined ? { type: 'unchanged' } : { type: 'reorder', sortOrder }
  return { type: 'change', action: moveAction(current, target), closedAt: target.kind === 'open' ? null : now, reopens: current.kind !== 'open' }
}

export function lostReasonFor(target: StageRef, raw: string | undefined) {
  if (target.kind !== 'lost') return null
  const reason = raw?.trim() ?? ''
  if (reason.length < MIN_LOST_REASON_LENGTH) fail(`Informe o motivo da perda (mínimo ${MIN_LOST_REASON_LENGTH} caracteres)`)
  return reason
}

/** Registro com dono se comporta como tarefa: o dono (`ownerId`) faz o papel de `assignedToId` na visibilidade. */
export const canSeeRecord = (me: AuthCtx, { teamId, ownerId }: Owned) => canSee(me, { teamId, assignedToId: ownerId })

/** Quem tem dono só deixa o dono ou um gestor mexer; sem dono, qualquer um que enxergue. */
export const canEditRecord = (me: AuthCtx, record: Owned) => canSeeRecord(me, record) && (record.ownerId === null || record.ownerId === me.userId || canManage(me, record))
