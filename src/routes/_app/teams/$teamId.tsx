import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { EditTeamForm } from '#/components/teams/EditTeamForm'
import { ResourceLinks } from '#/components/teams/ResourceLinks'
import { TeamGoals } from '#/components/teams/TeamGoals'
import { TeamMembers } from '#/components/teams/TeamMembers'
import { useAct } from '#/components/useAttempt'
import { appRoute } from '#/lib/app-route'
import { linkTeamToBoard, unlinkTeamFromBoard } from '#/server/boards'
import { linkTeamToPipeline, unlinkTeamFromPipeline } from '#/server/pipelines'
import { can } from '#/server/roles'
import { getTeamDetail, updateTeam } from '#/server/teams'

export const Route = createFileRoute('/_app/teams/$teamId')({
  staticData: { pageWidth: 'wide' },
  loader: ({ params }) => getTeamDetail({ data: { teamId: params.teamId } }),
  component: TeamDetail,
})

function TeamDetail() {
  const { me } = appRoute.useRouteContext()
  const { team, members, pipelines, boards, defaultPipeline, availablePipelines, availableBoards, goal, scoringRule } = Route.useLoaderData()
  const { error, act } = useAct()
  const canEdit = can(me, 'team.manage')
  const canLink = can(me, 'team.link', team.id)
  const usesDefaultPipeline = pipelines.every((p) => p.archived)

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

      <TeamMembers members={members} canManagePeople={can(me, 'user.read')} />

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
