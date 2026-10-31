import { createFileRoute, useRouter } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import * as React from 'react'
import { ManagedResourceItem } from '#/components/teams/ManagedResourceItem'
import { appRoute } from '#/lib/app-route'
import { archiveBoard, createBoard, listBoards, renameBoard, restoreBoard } from '#/server/boards'
import { can, isAdmin } from '#/server/roles'
import { getTaskFormOptions } from '#/server/tasks'

export const Route = createFileRoute('/_app/settings/boards')({
  loader: async () => {
    const [boards, options] = await Promise.all([listBoards(), getTaskFormOptions()])
    return { boards, teams: options.teams }
  },
  component: Boards,
})

function Boards() {
  const { me } = appRoute.useRouteContext()
  const { boards, teams } = Route.useLoaderData()
  const router = useRouter()
  const [error, setError] = React.useState<string | null>(null)

  async function act(fn: () => Promise<unknown>) {
    try {
      await fn()
      setError(null)
      router.invalidate()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro')
    }
  }

  if (!can(me, 'board.manage')) return <p className="card text-sm text-neutral-400">Você não tem permissão para gerir boards.</p>

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-neutral-400">Configurações</p>
        <h1 className="text-2xl font-bold tracking-tight">Boards</h1>
        <p className="mt-1 text-sm text-neutral-500">O board agrupa tarefas; as colunas continuam sendo o status. Só as equipes vinculadas criam tarefas nele. Os vínculos se editam no detalhe da equipe.</p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          const form = e.currentTarget
          const f = new FormData(form)
          act(() => createBoard({ data: { name: String(f.get('name')), teamIds: f.getAll('teamIds').map(String) } }).then(() => form.reset()))
        }}
        className="card space-y-3"
      >
        <div className="space-y-1">
          <label htmlFor="new-board">Novo board</label>
          <input id="new-board" name="name" required minLength={2} maxLength={80} />
        </div>
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">Equipes</legend>
          <p className="text-xs text-neutral-500">{isAdmin(me) ? 'Sem equipe, só o admin enxerga o board.' : 'Escolha ao menos uma equipe que você lidera.'}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {teams.map((t) => (
              <label key={t.id} className="flex items-center gap-2 text-sm text-neutral-200">
                <input type="checkbox" name="teamIds" value={t.id} className="h-4 w-4 p-0 accent-xp-400" /> {t.name}
              </label>
            ))}
            {teams.length === 0 && <p className="text-sm text-neutral-500">Nenhuma equipe disponível.</p>}
          </div>
        </fieldset>
        <button className="btn-primary"><Plus className="h-4 w-4" /> Criar</button>
      </form>
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
