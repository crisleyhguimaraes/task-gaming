import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { CalendarRange, Funnel, User, UsersRound } from 'lucide-react'
import * as React from 'react'
import { z } from 'zod'
import { FilterSelect } from '#/components/FilterSelect'
import { PageHeader } from '#/components/PageHeader'
import { PipelineBoard } from '#/components/pipeline/Board'
import type { MovePayload } from '#/components/pipeline/Board'
import { FunnelPanel } from '#/components/pipeline/FunnelPanel'
import { LostReasonModal } from '#/components/pipeline/LostReasonModal'
import { PipelineKpis } from '#/components/pipeline/PipelineKpis'
import { SearchField } from '#/components/SearchField'
import { TopbarSlot } from '#/components/Topbar'
import { matchesDeal } from '#/lib/deal-search'
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
  staticData: { pageWidth: 'full' },
  validateSearch: pipelineSearch,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const to = new Date()
    const from = new Date(to.getTime() - deps.periodDays * DAY_MS)
    const pipelines = (await listPipelines()).filter((p) => !p.archivedAt)
    const pipelineId = pipelines.find((p) => p.id === deps.pipelineId)?.id ?? pipelines[0]?.id
    if (!pipelineId) return null
    const [columns, filters, funnel] = await Promise.all([
      listPipeline({ data: { pipelineId, teamId: deps.teamId, ownerId: deps.ownerId } }),
      getPipelineFilters({ data: { teamId: deps.teamId } }),
      getFunnel({ data: { pipelineId, from: from.toISOString(), to: to.toISOString(), teamId: deps.teamId } }),
    ])
    return { pipelines, pipelineId, columns, filters, funnel }
  },
  component: PipelineOrEmpty,
})

function PipelineOrEmpty() {
  const data = Route.useLoaderData()
  if (!data) return <p className="card text-sm text-neutral-400">Nenhum pipeline disponível: entre em uma equipe para ver as oportunidades.</p>
  return <Pipeline {...data} />
}

type PipelineData = {
  pipelines: Array<{ id: string; name: string }>
  pipelineId: string
  columns: Awaited<ReturnType<typeof listPipeline>>
  filters: Awaited<ReturnType<typeof getPipelineFilters>>
  funnel: Awaited<ReturnType<typeof getFunnel>>
}

function Pipeline({ pipelines, pipelineId, columns, filters, funnel }: PipelineData) {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: '/pipeline' })
  const router = useRouter()
  const [error, setError] = React.useState<string | null>(null)
  const [pendingLoss, setPendingLoss] = React.useState<MovePayload | null>(null)
  const [query, setQuery] = React.useState('')
  const visible = React.useMemo(() => columns.map((c) => ({ ...c, opportunities: c.opportunities.filter((o) => matchesDeal(o, query)) })), [columns, query])
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
    <div className="space-y-5">
      <TopbarSlot>
        <SearchField value={query} onChange={setQuery} placeholder="Buscar negócio ou lead…" />
      </TopbarSlot>
      <PageHeader title="Pipeline" subtitle={pipelines.find((p) => p.id === pipelineId)?.name} />
      <PipelineKpis columns={columns} funnel={funnel} periodDays={search.periodDays} />
      <div className="flex flex-wrap items-center gap-2">
        {pipelines.length > 1 && (
          <FilterSelect label="Pipeline" icon={Funnel} value={pipelineId} onChange={(v) => set({ pipelineId: v })}>
            {pipelines.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </FilterSelect>
        )}
        {filters.teams.length > 0 && (
          <FilterSelect label="Equipe" icon={UsersRound} value={search.teamId ?? ''} onChange={(v) => set({ teamId: v || undefined, ownerId: undefined })}>
            <option value="">Todas as equipes</option>
            {filters.teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </FilterSelect>
        )}
        <FilterSelect label="Dono" icon={User} value={search.ownerId ?? ''} onChange={(v) => set({ ownerId: v || undefined })}>
          <option value="">Todos os donos</option>
          {filters.owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label="Período do funil" icon={CalendarRange} value={String(search.periodDays)} onChange={(v) => set({ periodDays: Number(v) })}>
          {PERIOD_OPTIONS.map((d) => (
            <option key={d} value={d}>
              Últimos {d} dias
            </option>
          ))}
        </FilterSelect>
        {(search.teamId || search.ownerId || search.pipelineId || query) && (
          <button
            type="button"
            className="btn-ghost px-3 py-2 text-xs"
            onClick={() => {
              setQuery('')
              navigate({ search: { periodDays: search.periodDays } })
            }}
          >
            Limpar filtros
          </button>
        )}
      </div>
      {error && <p className="rounded-xl border border-rose-900/50 bg-rose-950/40 px-3 py-2 text-sm text-rose-400">{error}</p>}

      <PipelineBoard columns={visible} onMove={onMove} />
      <FunnelPanel funnel={funnel} periodDays={search.periodDays} />

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
