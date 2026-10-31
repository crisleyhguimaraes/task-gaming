import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowDown, ArrowLeft, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { useAct } from '#/components/useAttempt'
import { appRoute } from '#/lib/app-route'
import { calculateNewOrder } from '#/lib/order'
import { can } from '#/server/roles'
import { createStage, deleteStage, listStages, reorderStage, updateStage } from '#/server/pipeline'
import { listPipelines } from '#/server/pipelines'

export const Route = createFileRoute('/_app/settings/pipeline/$pipelineId')({
  staticData: { pageWidth: 'narrow' },
  loader: async ({ params }) => {
    const [pipelines, stages] = await Promise.all([listPipelines(), listStages({ data: { pipelineId: params.pipelineId } })])
    return { pipeline: pipelines.find((p) => p.id === params.pipelineId) ?? null, stages }
  },
  component: PipelineSettings,
})

const KIND_LABEL = { open: 'Aberta', won: 'Ganha', lost: 'Perdida' } as const
type Stage = Awaited<ReturnType<typeof listStages>>[number]
type Kind = Stage['kind']

function PipelineSettings() {
  const { me } = appRoute.useRouteContext()
  const { pipeline, stages } = Route.useLoaderData()
  const { error, act } = useAct()

  function move(index: number, direction: -1 | 1) {
    const sibling = stages[index + direction]
    if (!sibling) return
    const beyond = stages[index + direction * 2]
    const [before, after] = direction === -1 ? [beyond, sibling] : [sibling, beyond]
    act(() => reorderStage({ data: { stageId: stages[index]!.id, sortOrder: calculateNewOrder(before?.sortOrder ?? null, after?.sortOrder ?? null) } }))
  }

  if (!can(me, 'pipeline.configure')) return <p className="card text-sm text-neutral-400">Só gestores gerais configuram o funil.</p>
  if (!pipeline) return <p className="card text-sm text-neutral-400">Pipeline não encontrado.</p>
  const pipelineId = pipeline.id

  return (
    <div className="space-y-5">
      <div>
        <Link to="/settings/pipeline" className="inline-flex items-center gap-1 text-sm text-neutral-400 hover:text-neutral-50">
          <ArrowLeft className="h-4 w-4" /> Pipelines
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Etapas de {pipeline.name}</h1>
        <p className="mt-1 text-sm text-neutral-500">O funil precisa de ao menos uma etapa aberta, uma ganha e uma perdida. Etapas que já tiveram oportunidades não podem ser excluídas nem mudar de tipo.</p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          const form = e.currentTarget
          const f = new FormData(form)
          act(() => createStage({ data: { pipelineId, name: String(f.get('name')), kind: String(f.get('kind')) as Kind, probability: Number(f.get('probability')) } }).then(() => form.reset()))
        }}
        className="card grid grid-cols-2 items-end gap-3 sm:grid-cols-[1fr_auto_auto_auto]"
      >
        <div className="col-span-2 space-y-1 sm:col-span-1">
          <label htmlFor="new-name">Nova etapa</label>
          <input id="new-name" name="name" required minLength={2} maxLength={60} />
        </div>
        <KindSelect id="new-kind" name="kind" defaultValue="open" label="Tipo" />
        <ProbabilityInput id="new-probability" name="probability" defaultValue={50} label="Probabilidade" />
        <button className="btn-primary"><Plus className="h-4 w-4" /> Criar</button>
      </form>
      {error && <p className="text-sm text-rose-400">{error}</p>}

      <ul className="divide-y divide-neutral-800 rounded-2xl border border-neutral-800">
        {stages.map((stage, i) => (
          <StageRow key={`${stage.id}:${stage.name}:${stage.kind}:${stage.probability}`} stage={stage} isFirst={i === 0} isLast={i === stages.length - 1} onMove={(d) => move(i, d)} act={act} />
        ))}
      </ul>
    </div>
  )
}

function StageRow({ stage, isFirst, isLast, onMove, act }: { stage: Stage; isFirst: boolean; isLast: boolean; onMove: (direction: -1 | 1) => void; act: (fn: () => Promise<unknown>) => void }) {
  return (
    <li>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const f = new FormData(e.currentTarget)
          act(() => updateStage({ data: { stageId: stage.id, name: String(f.get('name')), kind: (f.get('kind') as Kind | null) ?? undefined, probability: Number(f.get('probability')) } }))
        }}
        className="flex flex-wrap items-center gap-2 px-4 py-3"
      >
        <input name="name" defaultValue={stage.name} required minLength={2} maxLength={60} aria-label="Nome da etapa" className="min-w-[140px] flex-1" />
        <KindSelect name="kind" defaultValue={stage.kind} disabled={stage.inUse} title={stage.inUse ? 'Etapa já usada: o tipo não muda' : undefined} />
        <ProbabilityInput name="probability" defaultValue={stage.probability} />
        <button className="btn-ghost px-3 py-2 text-xs">Salvar</button>
        <button type="button" onClick={() => onMove(-1)} disabled={isFirst} className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-900 hover:text-neutral-50 disabled:opacity-30" title="Subir" aria-label={`Subir ${stage.name}`}><ArrowUp className="h-4 w-4" /></button>
        <button type="button" onClick={() => onMove(1)} disabled={isLast} className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-900 hover:text-neutral-50 disabled:opacity-30" title="Descer" aria-label={`Descer ${stage.name}`}><ArrowDown className="h-4 w-4" /></button>
        <button
          type="button"
          disabled={stage.inUse}
          onClick={() => confirm(`Excluir a etapa ${stage.name}?`) && act(() => deleteStage({ data: { stageId: stage.id } }))}
          className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-900 hover:text-rose-400 disabled:opacity-30"
          title={stage.inUse ? 'Etapa já usada: não pode ser excluída' : 'Excluir'}
          aria-label={`Excluir ${stage.name}`}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </form>
    </li>
  )
}

function KindSelect({ id, name, defaultValue, disabled, title, label }: { id?: string; name: string; defaultValue: Kind; disabled?: boolean; title?: string; label?: string }) {
  return (
    <div className="space-y-1">
      {label && <label htmlFor={id}>{label}</label>}
      <select id={id} name={name} defaultValue={defaultValue} disabled={disabled} title={title} aria-label="Tipo" className="w-auto">
        {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
    </div>
  )
}

function ProbabilityInput({ id, name, defaultValue, label }: { id?: string; name: string; defaultValue: number; label?: string }) {
  return (
    <div className="space-y-1">
      {label && <label htmlFor={id}>{label}</label>}
      <div className="flex items-center gap-1">
        <input id={id} name={name} type="number" min={0} max={100} step={1} defaultValue={defaultValue} required aria-label="Probabilidade (%)" className="w-20" />
        <span className="text-xs text-neutral-500">%</span>
      </div>
    </div>
  )
}
