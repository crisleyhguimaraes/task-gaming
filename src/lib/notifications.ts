import type { AuditMeta } from '#/db/schema'

type Compose = (by: string, title: string) => string

const messages = {
  'task.assigned': (by, title) => `${by} atribuiu a você "${title}"`,
  'points.approved': (by, title) => `${by} aprovou os pontos de "${title}"`,
  'points.rejected': (by, title) => `${by} rejeitou os pontos de "${title}"`,
  'note.created': (by, title) => `${by} comentou em "${title}"`,
} satisfies Record<string, Compose>

export type NotificationType = keyof typeof messages

const composers: Record<string, Compose> = messages

export function notificationMessage(type: string, payload: AuditMeta | null) {
  const compose = composers[type]
  return compose ? compose(String(payload?.by ?? 'Alguém'), String(payload?.taskTitle ?? '')) : type
}
