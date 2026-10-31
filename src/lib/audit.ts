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
  'challenge.teams_changed': 'Equipes do desafio alteradas',
  'challenge.attempt_finished': 'Tentativa de desafio concluída',
  'challenge.record_broken': 'Recorde de desafio batido',
  'user.created': 'Usuário criado',
  'user.updated': 'Usuário alterado',
  'invitation.created': 'Convite enviado',
  'invitation.resent': 'Convite reenviado',
  'invitation.cancelled': 'Convite cancelado',
  'invitation.accepted': 'Convite aceito',
  'team.created': 'Equipe criada',
  'team.updated': 'Equipe editada',
  'team.deleted': 'Equipe excluída',
  'team.member_added': 'Pessoa adicionada à equipe',
  'team.member_removed': 'Pessoa removida da equipe',
  'team.member_role_changed': 'Papel na equipe alterado',
  'tenant.created': 'Tenant criado',
  'tenant.admin_created': 'Admin do tenant criado',
  'auth.login': 'Login',
  'auth.login_failed': 'Falha de login',
  'impersonation.started': 'Impersonação iniciada',
  'impersonation.stopped': 'Impersonação encerrada',
  'access.denied': 'Acesso negado',
  'auth.password_reset': 'Senha redefinida',
  'auth.two_factor_enabled': '2FA ativado',
  'auth.two_factor_disabled': '2FA desativado',
  'user.deactivated': 'Usuário desativado',
  'user.reactivated': 'Usuário reativado',
  'permissions.changed': 'Permissões alteradas',
  'tenant.configured': 'Configurações do tenant alteradas',
  'task.restored': 'Tarefa restaurada',
  'note.created': 'Nota adicionada',
  'export.created': 'Exportação gerada',
  'lead.created': 'Lead criado',
  'lead.updated': 'Lead editado',
  'lead.claimed': 'Lead assumido do pool',
  'lead.assigned': 'Lead atribuído',
  'lead.imported': 'Leads importados',
  'lead.deleted': 'Lead excluído',
  'opportunity.created': 'Oportunidade criada',
  'opportunity.updated': 'Oportunidade editada',
  'opportunity.moved': 'Oportunidade mudou de etapa',
  'opportunity.won': 'Oportunidade ganha',
  'opportunity.lost': 'Oportunidade perdida',
  'opportunity.reopened': 'Oportunidade reaberta',
  'pipeline.created': 'Pipeline criado',
  'pipeline.updated': 'Pipeline renomeado',
  'pipeline.archived': 'Pipeline arquivado',
  'pipeline.restored': 'Pipeline restaurado',
  'pipeline.team_linked': 'Pipeline vinculado a equipe',
  'pipeline.team_unlinked': 'Pipeline desvinculado de equipe',
  'board.created': 'Board criado',
  'board.updated': 'Board renomeado',
  'board.archived': 'Board arquivado',
  'board.restored': 'Board restaurado',
  'board.team_linked': 'Board vinculado a equipe',
  'board.team_unlinked': 'Board desvinculado de equipe',
  'pipeline.stage_created': 'Etapa do funil criada',
  'pipeline.stage_updated': 'Etapa do funil alterada',
  'pipeline.stage_deleted': 'Etapa do funil excluída',
  'goal.created': 'Meta criada',
  'goal.updated': 'Meta alterada',
  'goal.deleted': 'Meta excluída',
  'goal.teams_changed': 'Equipes da meta alteradas',
  'scoring_rule.created': 'Pontuação criada',
  'scoring_rule.updated': 'Pontuação alterada',
  'scoring_rule.deleted': 'Pontuação excluída',
  'scoring_rule.teams_changed': 'Equipes da pontuação alteradas',
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
