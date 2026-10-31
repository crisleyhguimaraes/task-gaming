import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import * as React from 'react'
import { EditTeamForm } from '#/components/teams/EditTeamForm'
import { ResourceLinks } from '#/components/teams/ResourceLinks'
import { TeamGoals } from '#/components/teams/TeamGoals'
import { teamRoleLabel } from '#/components/users/model'
import { appRoute } from '#/lib/app-route'
import { linkTeamToBoard, unlinkTeamFromBoard } from '#/server/boards'
import { linkTeamToPipeline, unlinkTeamFromPipeline } from '#/server/pipelines'
import { can } from '#/server/roles'
import { getTeamDetail, updateTeam } from '#/server/teams'

export const Route = createFileRoute('/_app/teams/$teamId')({
  loader: ({ params }) => getTeamDetail({ data: { teamId: params.teamId } }),
  component: TeamDetail,
})

function TeamDetail() {
  const { me } = appRoute.useRouteContext()
  const { team, members, pipelines, boards, defaultPipeline, availablePipelines, availableBoards, goal, scoringRule } = Route.useLoaderData()
  const router = useRouter()
  const [error, setError] = React.useState<string | null>(null)
  const canEdit = can(me, 'team.manage')
  const canLink = can(me, 'team.link', team.id)
  const usesDefaultPipeline = pipelines.every((p) => p.archived)

  async function act(fn: () => Promise<unknown>) {
    try {
      await fn()
      setError(null)
      router.invalidate()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro')
    }
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <Link to="/team" search={{ period: 'week', teamId: team.id }} className="inline-flex items-center gap-1 text-sm text-neutral-400 hover:text-neutral-50">
          <ArrowLeft className="h-4 w-4" /> Ranking da equipe
        </Link>
        {!canEdit && (
          <>
            <h1 className="text-2xl font-bold tracking-tight">{team.name}</h1>
            {team.description && <p className="text-sm text-neutral-400">{team.description}</p>}
          </>
        )}
      </div>

      {canEdit && (
        <EditTeamForm key={`${team.name}:${team.description}`} team={team} onSave={(fields) => act(() => updateTeam({ data: { teamId: team.id, ...fields } }))} />
      )}
      {error && <p role="alert" className="text-sm text-rose-400">{error}</p>}

      <section aria-labelledby="team-members" className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="team-members" className="text-sm font-semibold text-neutral-200">Membros</h2>
          {can(me, 'user.read') && <Link to="/settings/users" className="text-xs text-neutral-400 underline hover:text-neutral-50">Gerenciar pessoas</Link>}
        </div>
        <ul className="divide-y divide-neutral-800">
          {members.map((m) => (
            <li key={m.userId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span className="font-medium">{m.name}{m.banned && <span className="ml-2 text-xs text-amber-400">desativado</span>}</span>
              <span className="text-xs text-neutral-400">{teamRoleLabel[m.role]}</span>
            </li>
          ))}
          {members.length === 0 && <li className="py-2 text-sm text-neutral-500">Nenhum membro ainda.</li>}
        </ul>
      </section>

      <ResourceLinks
        title="Pipelines vinculados"
        singular="pipeline"
        hint={
          usesDefaultPipeline ? (
            <>Esta equipe usa o pipeline padrão do tenant{defaultPipeline ? <> (<b className="text-neutral-200">{defaultPipeline.name}</b>)</> : null} enquanto não tiver vínculo ativo. Ao vincular, só os pipelines vinculados valem.</>
          ) : (
            'Só os pipelines vinculados valem para esta equipe; o padrão do tenant não se aplica. Remova todos os vínculos para voltar ao padrão. Oportunidades já abertas continuam onde estão.'
          )
        }
        items={pipelines}
        available={availablePipelines}
        canLink={canLink}
        onAdd={(pipelineId) => act(() => linkTeamToPipeline({ data: { pipelineId, teamId: team.id } }))}
        onRemove={(p) => act(() => unlinkTeamFromPipeline({ data: { pipelineId: p.id, teamId: team.id } }))}
      />

      <ResourceLinks
        title="Boards vinculados"
        singular="board"
        hint="Só os boards vinculados aparecem ao criar tarefa para esta equipe. Tarefas sem board continuam valendo, e desvincular não mexe nas tarefas que já existem."
        items={boards}
        available={availableBoards}
        canLink={canLink}
        onAdd={(boardId) => act(() => linkTeamToBoard({ data: { boardId, teamId: team.id } }))}
        onRemove={(b) => act(() => unlinkTeamFromBoard({ data: { boardId: b.id, teamId: team.id } }))}
      />

      <TeamGoals goal={goal} scoringRule={scoringRule} canConfigure={can(me, 'goal.configure') || can(me, 'scoring.configure')} />
    </div>
  )
}
