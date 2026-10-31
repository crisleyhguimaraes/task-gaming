import { Link, createFileRoute } from '@tanstack/react-router'
import { ListOrdered, Plus } from 'lucide-react'
import { ManagedResourceItem } from '#/components/teams/ManagedResourceItem'
import { useAct } from '#/components/useAttempt'
import { appRoute } from '#/lib/app-route'
import { archivePipeline, createPipeline, listPipelines, renamePipeline, restorePipeline } from '#/server/pipelines'
import { can } from '#/server/roles'

export const Route = createFileRoute('/_app/settings/pipeline/')({
  loader: () => listPipelines(),
  component: PipelineList,
})

function PipelineList() {
  const { me } = appRoute.useRouteContext()
  const pipelines = Route.useLoaderData()
  const { error, act } = useAct()

  if (!can(me, 'pipeline.configure')) return <p className="card text-sm text-neutral-400">Só gestores gerais configuram os pipelines.</p>

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-neutral-400">Configurações</p>
        <h1 className="text-2xl font-bold tracking-tight">Pipelines</h1>
        <p className="mt-1 text-sm text-neutral-500">Cada pipeline tem as próprias etapas. A equipe sem vínculo usa o pipeline padrão; ao vincular, só os vinculados valem. Os vínculos se editam no detalhe da equipe.</p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          const form = e.currentTarget
          act(() => createPipeline({ data: { name: String(new FormData(form).get('name')) } }).then(() => form.reset()))
        }}
        className="card flex items-end gap-3"
      >
        <div className="flex-1 space-y-1">
          <label htmlFor="new-pipeline">Novo pipeline</label>
          <input id="new-pipeline" name="name" required minLength={2} maxLength={80} />
        </div>
        <button className="btn-primary"><Plus className="h-4 w-4" /> Criar</button>
      </form>
      {error && <p role="alert" className="text-sm text-rose-400">{error}</p>}

      <ul className="divide-y divide-neutral-800 rounded-2xl border border-neutral-800">
        {pipelines.map((p) => (
          <ManagedResourceItem
            key={`${p.id}:${p.name}`}
            name={p.name}
            archived={p.archivedAt !== null}
            badge={p.isDefault ? 'Padrão' : undefined}
            teams={p.teams}
            emptyTeamsText={p.isDefault ? 'Usado pelas equipes sem vínculo.' : 'Nenhuma equipe vinculada: ninguém abre oportunidades aqui.'}
            canManage
            canArchive={!p.isDefault}
            extra={
              <Link to="/settings/pipeline/$pipelineId" params={{ pipelineId: p.id }} className="btn-ghost px-3 py-2 text-xs">
                <ListOrdered className="h-4 w-4" /> Etapas
              </Link>
            }
            act={act}
            onRename={(name) => renamePipeline({ data: { pipelineId: p.id, name } })}
            onArchive={() => archivePipeline({ data: { pipelineId: p.id } })}
            onRestore={() => restorePipeline({ data: { pipelineId: p.id } })}
          />
        ))}
      </ul>
    </div>
  )
}
