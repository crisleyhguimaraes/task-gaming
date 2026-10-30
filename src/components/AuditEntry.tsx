import { Link } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import type { AuditChanges, AuditMeta, AuditValue } from '#/db/schema'
import { auditActionLabels } from '#/lib/audit'

export type AuditEntryEvent = {
  action: string
  actorName: string
  impersonatedBy: string | null
  impersonatorName?: string | null
  entityType: string
  entityId: string
  createdAt: Date | string
  changes: AuditChanges | null
  meta: AuditMeta | null
}

export const entityLabels: Record<string, string> = {
  task: 'Tarefa',
  user: 'Usuário',
  team: 'Equipe',
  tenant: 'Tenant',
  invitation: 'Convite',
  challenge: 'Desafio',
  lead: 'Lead',
  opportunity: 'Oportunidade',
  pipeline_stage: 'Etapa do funil',
  role: 'Papel',
  export: 'Exportação',
}

const actionLabels: Record<string, string> = auditActionLabels
const formatValue = (value: AuditValue) => (value === null ? '—' : String(value))
const formatWhen = (date: Date | string) => new Date(date).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' })
const hasDetails = (e: AuditEntryEvent) => Object.keys(e.changes ?? {}).length > 0 || Object.keys(e.meta ?? {}).length > 0

/** Uma linha de auditoria; vira expansível quando há alterações (de → para) ou detalhes. */
export function AuditEntry({ event, showEntity = true }: { event: AuditEntryEvent; showEntity?: boolean }) {
  const summary = (
    <>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{actionLabels[event.action] ?? event.action}</div>
        <div className="truncate text-xs text-neutral-400">
          {event.actorName}
          {event.impersonatedBy && <span className="text-amber-400"> · via impersonação de {event.impersonatorName ?? 'usuário removido'}</span>}
          {showEntity && ` · ${entityLabels[event.entityType] ?? event.entityType}`}
        </div>
      </div>
      <time dateTime={new Date(event.createdAt).toISOString()} className="shrink-0 text-xs text-neutral-500">{formatWhen(event.createdAt)}</time>
    </>
  )
  if (!hasDetails(event)) return <div className="flex items-center gap-3 px-4 py-3">{summary}</div>

  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 hover:bg-neutral-900/60 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-4 w-4 shrink-0 text-neutral-500 transition-transform group-open:rotate-90" aria-hidden />
        {summary}
      </summary>
      <div className="space-y-2 bg-neutral-950/40 px-4 py-3 pl-11 text-xs">
        {showEntity && event.entityType === 'task' && (
          <Link to="/tasks/$taskId" params={{ taskId: event.entityId }} className="text-xp-400 hover:underline">Abrir tarefa</Link>
        )}
        {event.changes && (
          <dl className="space-y-1">
            {Object.entries(event.changes).map(([field, { from, to }]) => (
              <div key={field} className="flex flex-wrap gap-x-2">
                <dt className="font-medium text-neutral-300">{field}</dt>
                <dd className="text-neutral-400"><span className="line-through">{formatValue(from)}</span> → <span className="text-neutral-100">{formatValue(to)}</span></dd>
              </div>
            ))}
          </dl>
        )}
        {event.meta && (
          <dl className="space-y-1">
            {Object.entries(event.meta).map(([key, value]) => (
              <div key={key} className="flex flex-wrap gap-x-2">
                <dt className="font-medium text-neutral-300">{key}</dt>
                <dd className="text-neutral-400">{formatValue(value)}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </details>
  )
}
