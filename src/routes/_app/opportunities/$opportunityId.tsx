import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { ArrowLeft, Plus } from 'lucide-react'
import * as React from 'react'
import { LostReasonModal } from '#/components/pipeline/LostReasonModal'
import { Notes } from '#/components/Notes'
import { appRoute } from '#/lib/app-route'
import { formatCents, toCents } from '#/lib/pipeline'
import { getOpportunity, moveOpportunity, updateOpportunity } from '#/server/pipeline'
import { listNotes } from '#/server/notes'
import { getTaskFormOptions } from '#/server/tasks'

export const Route = createFileRoute('/_app/opportunities/$opportunityId')({
  loader: async ({ params }) => {
    const [detail, notes, options] = await Promise.all([
      getOpportunity({ data: { opportunityId: params.opportunityId } }),
      listNotes({ data: { type: 'opportunity', id: params.opportunityId } }),
      getTaskFormOptions(),
    ])
    return { detail, notes, members: options.members.filter((m) => m.teamId === detail.opportunity.teamId) }
  },
  component: OpportunityPage,
})

const TASK_STATUS_LABEL = { pending: 'A fazer', in_progress: 'Em andamento', paused: 'Pausada', finished: 'Concluída', cancelled: 'Cancelada' } as const
const formatDateTime = (value: Date | string) => new Date(value).toLocaleString('pt-BR')

function OpportunityPage() {
  const { me } = appRoute.useRouteContext()
  const { detail, notes, members } = Route.useLoaderData()
  const { opportunity: opp, history, followUps, stages, canWrite, canReopen } = detail
  const router = useRouter()
  const [error, setError] = React.useState<string | null>(null)
  const [pendingLossStageId, setPendingLossStageId] = React.useState<string | null>(null)
  const isClosed = opp.stageKind !== 'open'

  async function act(fn: () => Promise<unknown>) {
    try {
      await fn()
      setError(null)
      router.invalidate()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro')
    }
  }

  const moveTo = (toStageId: string, lostReason?: string) => act(() => moveOpportunity({ data: { opportunityId: opp.id, toStageId, lostReason } }))

  function onStageChange(toStageId: string) {
    if (stages.find((s) => s.id === toStageId)?.kind === 'lost') setPendingLossStageId(toStageId)
    else moveTo(toStageId)
  }

  function onSave(form: HTMLFormElement) {
    const f = new FormData(form)
    act(() =>
      updateOpportunity({
        data: {
          opportunityId: opp.id,
          title: String(f.get('title')),
          amountCents: toCents(Number(f.get('amount') || 0)),
          expectedCloseDate: String(f.get('expectedCloseDate')) || null,
          ownerId: String(f.get('ownerId')) || null,
        },
      }),
    )
  }

  return (
    <div className="space-y-6">
      <Link to="/pipeline" className="inline-flex items-center gap-1 text-sm text-neutral-400 hover:text-neutral-50">
        <ArrowLeft className="h-4 w-4" /> Pipeline
      </Link>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{opp.title}</h1>
        <p className="text-sm text-neutral-400">
          {opp.leadName} · {opp.teamName} · <b className="text-xp-400">{formatCents(opp.amountCents)}</b>
        </p>
      </div>
      {error && <p className="rounded-lg border border-rose-900/50 bg-rose-950/40 px-3 py-2 text-sm text-rose-400">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card space-y-3">
          <h2 className="text-sm font-semibold text-neutral-300">Etapa</h2>
          <select value={opp.stageId} onChange={(e) => onStageChange(e.target.value)} disabled={!canWrite || (isClosed && !canReopen)} aria-label="Etapa">
            {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {isClosed && !canReopen && <p className="text-xs text-neutral-500">Só gestores reabrem uma oportunidade fechada.</p>}
          {opp.closedAt && <p className="text-xs text-neutral-400">Fechada em {formatDateTime(opp.closedAt)}</p>}
          {opp.lostReason && <p className="text-sm text-rose-400">Motivo da perda: {opp.lostReason}</p>}
        </section>

        <form
          key={String(opp.updatedAt)}
          onSubmit={(e) => {
            e.preventDefault()
            onSave(e.currentTarget)
          }}
          className="card space-y-3"
        >
          <h2 className="text-sm font-semibold text-neutral-300">Dados</h2>
          <fieldset disabled={!canWrite} className="space-y-3">
            <div className="space-y-1">
              <label htmlFor="title">Título</label>
              <input id="title" name="title" required minLength={2} maxLength={200} defaultValue={opp.title} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label htmlFor="amount">Valor (R$)</label>
                <input id="amount" name="amount" type="number" min={0} step="0.01" defaultValue={opp.amountCents / 100} />
              </div>
              <div className="space-y-1">
                <label htmlFor="expectedCloseDate">Previsão de fechamento</label>
                <input id="expectedCloseDate" name="expectedCloseDate" type="date" defaultValue={opp.expectedCloseDate ?? ''} />
              </div>
            </div>
            <div className="space-y-1">
              <label htmlFor="ownerId">Dono</label>
              <select id="ownerId" name="ownerId" defaultValue={opp.ownerId ?? ''}>
                <option value="">Sem dono</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            {canWrite && <button className="btn-primary w-full">Salvar</button>}
          </fieldset>
        </form>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-300">Follow-ups</h2>
          {me.role !== 'MEMBER' && (
            <Link to="/tasks/new" search={{ opportunityId: opp.id }} className="btn-primary px-3 py-2 text-xs">
              <Plus className="h-4 w-4" /> Novo follow-up
            </Link>
          )}
        </div>
        <ul className="divide-y divide-neutral-800 rounded-2xl border border-neutral-800">
          {followUps.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <Link to="/tasks/$taskId" params={{ taskId: t.id }} className="font-medium hover:underline">{t.title}</Link>
              <span className="text-xs text-neutral-400">
                {TASK_STATUS_LABEL[t.status]} · {t.assigneeName ?? 'Pool'}
                {t.dueDate && ` · até ${t.dueDate.slice(8)}/${t.dueDate.slice(5, 7)}`}
              </span>
            </li>
          ))}
          {followUps.length === 0 && <li className="px-4 py-6 text-center text-sm text-neutral-500">Nenhum follow-up ainda.</li>}
        </ul>
      </section>

      <Notes target={{ type: 'opportunity', id: opp.id }} notes={notes} />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-neutral-300">Histórico de etapas</h2>
        <ul className="divide-y divide-neutral-800 rounded-2xl border border-neutral-800">
          {history.map((h) => (
            <li key={h.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <span>{h.fromStageName ? `${h.fromStageName} → ${h.toStageName}` : `Criada em ${h.toStageName}`}</span>
              <span className="text-xs text-neutral-500">{h.changedByName ?? 'Usuário removido'} · {formatDateTime(h.changedAt)}</span>
            </li>
          ))}
        </ul>
      </section>

      <LostReasonModal
        title={pendingLossStageId ? opp.title : null}
        onCancel={() => setPendingLossStageId(null)}
        onConfirm={(reason) => {
          const stageId = pendingLossStageId!
          setPendingLossStageId(null)
          moveTo(stageId, reason)
        }}
      />
    </div>
  )
}
