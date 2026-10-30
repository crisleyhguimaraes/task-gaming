import type { AuditChanges, AuditValue } from '#/db/schema'

export const auditActionLabels = {
  'task.created': 'Tarefa criada',
  'task.updated': 'Tarefa editada',
  'task.cancelled': 'Tarefa cancelada',
  'task.returned_to_pool': 'Tarefa devolvida ao pool',
  'task.finished_manually': 'Tarefa concluída manualmente',
  'task.points_validated': 'Pontos aprovados',
  'task.points_rejected': 'Pontos rejeitados',
  'dependency.added': 'Dependência adicionada',
  'dependency.removed': 'Dependência removida',
  'challenge.created': 'Desafio criado',
  'challenge.archived': 'Desafio arquivado',
  'user.created': 'Usuário criado',
  'user.updated': 'Usuário alterado',
  'invitation.created': 'Convite enviado',
  'invitation.resent': 'Convite reenviado',
  'invitation.cancelled': 'Convite cancelado',
  'invitation.accepted': 'Convite aceito',
  'team.created': 'Equipe criada',
  'team.deleted': 'Equipe excluída',
  'tenant.created': 'Tenant criado',
  'tenant.admin_created': 'Admin do tenant criado',
  'auth.login': 'Login',
  'auth.login_failed': 'Falha de login',
  'impersonation.started': 'Impersonação iniciada',
  'impersonation.stopped': 'Impersonação encerrada',
} as const

export type AuditAction = keyof typeof auditActionLabels
export const auditActions = Object.keys(auditActionLabels) as [AuditAction, ...Array<AuditAction>]

type ScalarKeys<T> = { [K in keyof T]: T[K] extends AuditValue ? K : never }[keyof T]

export function diffFields<T extends object>(before: T, after: T, keys: ReadonlyArray<ScalarKeys<T>>): AuditChanges {
  const changes: AuditChanges = {}
  for (const key of keys) {
    const from = before[key] as AuditValue
    const to = after[key] as AuditValue
    if (from !== to) changes[String(key)] = { from, to }
  }
  return changes
}
