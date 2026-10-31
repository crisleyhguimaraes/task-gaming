import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { Plus, Trash2 } from 'lucide-react'
import * as React from 'react'
import { createTeam, deleteTeam, listTeams } from '#/server/teams'

export const Route = createFileRoute('/_app/settings/teams')({
  loader: () => listTeams(),
  component: Teams,
})

function Teams() {
  const list = Route.useLoaderData()
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

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-neutral-400">Configurações</p>
        <h1 className="text-2xl font-bold tracking-tight">Equipes</h1>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const form = e.currentTarget
          act(() => createTeam({ data: { name: String(new FormData(form).get('name')) } }).then(() => form.reset()))
        }}
        className="card flex items-end gap-3"
      >
        <div className="flex-1 space-y-1">
          <label htmlFor="name">Nova equipe</label>
          <input id="name" name="name" required minLength={2} />
        </div>
        <button className="btn-primary"><Plus className="h-4 w-4" /> Criar</button>
      </form>
      {error && <p className="text-sm text-rose-400">{error}</p>}
      <ul className="divide-y divide-neutral-800 rounded-2xl border border-neutral-800">
        {list.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <Link to="/teams/$teamId" params={{ teamId: t.id }} className="font-medium hover:underline">{t.name}</Link>
              {t.description && <div className="truncate text-xs text-neutral-400">{t.description}</div>}
              <div className="text-xs text-neutral-500">{t.members} membros</div>
            </div>
            <button onClick={() => confirm(`Excluir ${t.name}?`) && act(() => deleteTeam({ data: { teamId: t.id } }))} className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-900 hover:text-rose-400" title="Excluir" aria-label={`Excluir ${t.name}`}>
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        ))}
        {list.length === 0 && <li className="px-4 py-6 text-center text-sm text-neutral-500">Nenhuma equipe ainda.</li>}
      </ul>
    </div>
  )
}
