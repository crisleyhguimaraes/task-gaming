import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import * as React from 'react'
import { z } from 'zod'
import { listBoards } from '#/server/boards'
import { getOpportunity } from '#/server/pipeline'
import { createTask, getTaskFormOptions } from '#/server/tasks'

export const Route = createFileRoute('/_app/tasks/new')({
  staticData: { pageWidth: 'narrow' },
  validateSearch: z.object({ opportunityId: z.uuid().optional() }),
  loaderDeps: ({ search }) => ({ opportunityId: search.opportunityId }),
  loader: async ({ deps }) => {
    const [options, boards, detail] = await Promise.all([
      getTaskFormOptions(),
      listBoards(),
      deps.opportunityId ? getOpportunity({ data: { opportunityId: deps.opportunityId } }) : null,
    ])
    return { ...options, boards: boards.filter((b) => !b.archivedAt), opportunity: detail?.opportunity ?? null }
  },
  component: NewTask,
})

function NewTask() {
  const { teams, members, boards, opportunity } = Route.useLoaderData()
  const router = useRouter()
  const [teamId, setTeamId] = React.useState(opportunity?.teamId ?? teams[0]?.id ?? '')
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    setBusy(true)
    try {
      const task = await createTask({
        data: {
          title: String(f.get('title')),
          description: String(f.get('description') ?? ''),
          basePoints: Number(f.get('basePoints')),
          estimatedMinutes: Number(f.get('estimatedMinutes')),
          teamId,
          assignedToId: String(f.get('assignedToId')) || null,
          boardId: String(f.get('boardId') ?? '') || null,
          opportunityId: opportunity?.id,
        },
      })
      await router.invalidate()
      router.navigate({ to: '/tasks/$taskId', params: { taskId: task.id } })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar')
      setBusy(false)
    }
  }

  const teamBoards = boards.filter((b) => b.teams.some((t) => t.id === teamId))

  if (teams.length === 0) {
    return <p className="card text-sm text-neutral-400">Você precisa estar em uma equipe (ou criar uma em Configurações) antes de criar tarefas.</p>
  }

  return (
    <div className="space-y-4">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-neutral-400 hover:text-neutral-50">
        <ArrowLeft className="h-4 w-4" /> Hoje
      </Link>
      <h1 className="text-2xl font-bold tracking-tight">{opportunity ? 'Novo follow-up' : 'Nova tarefa'}</h1>
      {opportunity && <p className="text-sm text-neutral-400">Oportunidade: <b className="text-neutral-200">{opportunity.title}</b></p>}
      <form onSubmit={onSubmit} className="card space-y-4">
        <div className="space-y-1">
          <label htmlFor="title">Título</label>
          <input id="title" name="title" required minLength={2} maxLength={200} defaultValue={opportunity ? `Follow-up: ${opportunity.title}` : undefined} />
        </div>
        <div className="space-y-1">
          <label htmlFor="description">Descrição</label>
          <textarea id="description" name="description" rows={3} maxLength={2000} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label htmlFor="basePoints">Pontos</label>
            <input id="basePoints" name="basePoints" type="number" min={1} max={10000} defaultValue={10} required />
          </div>
          <div className="space-y-1">
            <label htmlFor="estimatedMinutes">Estimativa (min)</label>
            <input id="estimatedMinutes" name="estimatedMinutes" type="number" min={1} max={1440} defaultValue={30} required />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label htmlFor="teamId">Equipe</label>
            <select id="teamId" value={teamId} onChange={(e) => setTeamId(e.target.value)} disabled={opportunity !== null}>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="assignedToId">Responsável</label>
            <select id="assignedToId" name="assignedToId" defaultValue={opportunity?.ownerId ?? ''}>
              <option value="">Pool da equipe</option>
              {members.filter((m) => m.teamId === teamId).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
        </div>
        {teamBoards.length > 0 && (
          <div key={teamId} className="space-y-1">
            <label htmlFor="boardId">Board (opcional)</label>
            <select id="boardId" name="boardId" defaultValue="">
              <option value="">Sem board</option>
              {teamBoards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        )}
        {error && <p className="text-sm text-rose-400">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>Criar tarefa</button>
      </form>
    </div>
  )
}
