import { createFileRoute } from '@tanstack/react-router'
import { ManagedResourceItem } from '#/components/teams/ManagedResourceItem'
import { NewBoardForm } from '#/components/teams/NewBoardForm'
import { useAct } from '#/components/useAttempt'
import { appRoute } from '#/lib/app-route'
import { archiveBoard, listBoards, renameBoard, restoreBoard } from '#/server/boards'
import { can } from '#/server/roles'
import { getTaskFormOptions } from '#/server/tasks'
import { PageHeader } from '#/components/PageHeader'

export const Route = createFileRoute('/_app/settings/boards')({
  staticData: { pageWidth: 'narrow' },
  loader: async () => {
    const [boards, options] = await Promise.all([listBoards(), getTaskFormOptions()])
    return { boards, teams: options.teams }
  },
  component: Boards,
})

function Boards() {
  const { me } = appRoute.useRouteContext()
  const { boards, teams } = Route.useLoaderData()
  const { error, act } = useAct()

  if (!can(me, 'board.manage')) return <p className="card text-sm text-neutral-400">Você não tem permissão para gerir boards.</p>

  return (
    <div className="space-y-5">
      <PageHeader title="Boards" subtitle="O board agrupa tarefas; as colunas continuam sendo o status. Só as equipes vinculadas criam tarefas nele. Os vínculos se editam no detalhe da equipe." />

      <NewBoardForm me={me} teams={teams} act={act} />
      {error && <p role="alert" className="text-sm text-rose-400">{error}</p>}

      <ul className="divide-y divide-neutral-800 rounded-2xl border border-neutral-800">
        {boards.map((b) => (
          <ManagedResourceItem
            key={`${b.id}:${b.name}`}
            name={b.name}
            archived={b.archivedAt !== null}
            teams={b.teams}
            emptyTeamsText="Nenhuma equipe vinculada: só o admin enxerga este board."
            canManage={b.canManage}
            act={act}
            onRename={(name) => renameBoard({ data: { boardId: b.id, name } })}
            onArchive={() => archiveBoard({ data: { boardId: b.id } })}
            onRestore={() => restoreBoard({ data: { boardId: b.id } })}
          />
        ))}
        {boards.length === 0 && <li className="px-4 py-6 text-center text-sm text-neutral-500">Nenhum board ainda.</li>}
      </ul>
    </div>
  )
}
