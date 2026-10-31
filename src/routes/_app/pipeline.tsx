import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import * as React from 'react'
import { z } from 'zod'
import { PipelineBoard } from '#/components/pipeline/Board'
import type { MovePayload } from '#/components/pipeline/Board'
import { FunnelPanel } from '#/components/pipeline/FunnelPanel'
import { LostReasonModal } from '#/components/pipeline/LostReasonModal'
import { getFunnel, getPipelineFilters, listPipeline, moveOpportunity } from '#/server/pipeline'
import { listPipelines } from '#/server/pipelines'

const DAY_MS = 86_400_000
const DEFAULT_PERIOD_DAYS = 90
const PERIOD_OPTIONS = [30, 90, 365]

const pipelineSearch = z.object({
  pipelineId: z.uuid().optional(),
  teamId: z.uuid().optional(),
  ownerId: z.string().optional(),
  periodDays: z.number().int().min(1).max(730).default(DEFAULT_PERIOD_DAYS),
})

export const Route = createFileRoute('/_app/pipeline')({
  validateSearch: pipelineSearch,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const to = new Date()
    const from = new Date(to.getTime() - deps.periodDays * DAY_MS)
    const pipelines = await listPipelines()
    const pipelineId = pipelines.find((p) => p.id === deps.pipelineId)?.id ?? pipelines.find((p) => !p.archivedAt)?.id
    if (!pipelineId) return null
    const [columns, filters, funnel] = await Promise.all([
      listPipeline({ data: { pipelineId, teamId: deps.teamId, ownerId: deps.ownerId } }),
      getPipelineFilters({ data: { teamId: deps.teamId } }),
      getFunnel({ data: { pipelineId, from: from.toISOString(), to: to.toISOString(), teamId: deps.teamId } }),
    ])
    return { columns, filters, funnel }
  },
  component: PipelineOrEmpty,
})

function PipelineOrEmpty() {
  const data = Route.useLoaderData()
  if (!data) return <p className="card text-sm text-neutral-400">Nenhum pipeline disponível: entre em uma equipe para ver as oportunidades.</p>
  return <Pipeline {...data} />
}

type PipelineData = {
  columns: Awaited<ReturnType<typeof listPipeline>>
  filters: Awaited<ReturnType<typeof getPipelineFilters>>
  funnel: Awaited<ReturnType<typeof getFunnel>>
}

function Pipeline({ columns, filters, funnel }: PipelineData) {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: '/pipeline' })
  const router = useRouter()
  const [error, setError] = React.useState<string | null>(null)
  const [pendingLoss, setPendingLoss] = React.useState<MovePayload | null>(null)
  const set = (patch: Partial<typeof search>) => navigate({ search: (prev) => ({ ...prev, ...patch }) })

  async function apply(p: MovePayload, lostReason?: string) {
    try {
      await moveOpportunity({ data: { opportunityId: p.card.id, toStageId: p.toStage.id, sortOrder: p.sortOrder, lostReason } })
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Movimento não permitido')
    }
    router.invalidate()
  }

  function onMove(p: MovePayload) {
    if (p.toStage.kind === 'lost' && p.card.stageId !== p.toStage.id) setPendingLoss(p)
    else apply(p)
  }

  function cancelLoss() {
    if (!pendingLoss) return
    setPendingLoss(null)
    router.invalidate()
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Pipeline</h1>

      <div className="flex flex-wrap gap-2">
        {filters.teams.length > 0 && (
          <select value={search.teamId ?? ''} onChange={(e) => set({ teamId: e.target.value || undefined, ownerId: undefined })} className="w-auto" aria-label="Equipe">
            <option value="">Todas as equipes</option>
            {filters.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
        <select value={search.ownerId ?? ''} onChange={(e) => set({ ownerId: e.target.value || undefined })} className="w-auto" aria-label="Dono">
          <option value="">Todos os donos</option>
          {filters.owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <select value={search.periodDays} onChange={(e) => set({ periodDays: Number(e.target.value) })} className="w-auto" aria-label="Período do funil">
          {PERIOD_OPTIONS.map((d) => <option key={d} value={d}>Funil: últimos {d} dias</option>)}
        </select>
      </div>
      {error && <p className="rounded-lg border border-rose-900/50 bg-rose-950/40 px-3 py-2 text-sm text-rose-400">{error}</p>}

      <PipelineBoard columns={columns} onMove={onMove} />
      <FunnelPanel funnel={funnel} columns={columns} periodDays={search.periodDays} />

      <LostReasonModal
        title={pendingLoss?.card.title ?? null}
        onCancel={cancelLoss}
        onConfirm={(reason) => {
          const p = pendingLoss!
          setPendingLoss(null)
          apply(p, reason)
        }}
      />
    </div>
  )
}
