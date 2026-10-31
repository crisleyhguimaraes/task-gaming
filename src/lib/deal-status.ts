import type { StageKind } from '#/db/schema'
import { MS_PER_DAY } from './goals'

export type DealStatus = 'overdue' | 'soon' | 'on_track'

const SOON_DAYS = 7

export const DEAL_STATUS_LABEL: Record<DealStatus, string> = { overdue: 'Atrasada', soon: 'Vence logo', on_track: 'No prazo' }

const pad = (n: number) => String(n).padStart(2, '0')

export const localToday = (now = new Date()) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`

/** Datas `YYYY-MM-DD` viram meia-noite UTC dos dois lados, então a diferença é de dias inteiros. */
export function dealStatus(expectedCloseDate: string | null, stageKind: StageKind, today: string): DealStatus | null {
  if (stageKind !== 'open' || !expectedCloseDate) return null
  const days = (Date.parse(expectedCloseDate) - Date.parse(today)) / MS_PER_DAY
  if (days < 0) return 'overdue'
  return days <= SOON_DAYS ? 'soon' : 'on_track'
}
