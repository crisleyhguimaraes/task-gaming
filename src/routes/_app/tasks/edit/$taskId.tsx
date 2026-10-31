import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { ArrowLeft, Link2, X } from 'lucide-react'
import * as React from 'react'
import { PRIORITY_LABEL } from '#/components/kanban/Card'
import { listBoards } from '#/server/boards'
import { addDependency, getDependencies, removeDependency } from '#/server/dependencies'
import { getTask, getTaskFormOptions, updateTask } from '#/server/tasks'

export const Route = createFileRoute('/_app/tasks/edit/$taskId')({
  loader: async ({ params }) => {
    const [task, options, deps, boards] = await Promise.all([
      getTask({ data: { taskId: params.taskId } }),
      getTaskFormOptions(),
      getDependencies({ data: { taskId: params.taskId } }),
      listBoards(),
    ])
    return { task, options, deps, boards: boards.filter((b) => !b.archivedAt) }
  },
  component: EditTask,
})

function EditTask() {
  const { task, options, deps, boards } = Route.useLoaderData()
  const router = useRouter()
  const [error, setError] = React.useState<string | null>(null)
  const members = options.members.filter((m) => m.teamId === task.teamId)
  const teamBoards = boards.filter((b) => b.teams.some((t) => t.id === task.teamId))

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    try {
      await updateTask({
        data: {
          taskId: task.id,
          title: String(f.get('title')),
          description: String(f.get('description') ?? ''),
          basePoints: Number(f.get('basePoints')),
          estimatedMinutes: Number(f.get('estimatedMinutes')),
          priority: String(f.get('priority')) as keyof typeof PRIORITY_LABEL,
          dueDate: String(f.get('dueDate')) || null,
          scheduledStart: String(f.get('scheduledStart')) || null,
          scheduledEnd: String(f.get('scheduledEnd')) || null,
          assignedToId: String(f.get('assignedToId')) || null,
          boardId: f.has('boardId') ? String(f.get('boardId')) || null : undefined,
        },
      })
      await router.invalidate()
      router.navigate({ to: '/tasks/$taskId', params: { taskId: task.id } })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar')
    }
  }

  async function dep(fn: () => Promise<unknown>) {
    try {
      await fn()
      setError(null)
      router.invalidate()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro')
    }
  }

  if (!task.canManage) return <p className="card text-sm text-neutral-400">Sem permissão para editar.</p>

  return (
    <div className="space-y-4">
      <Link to="/tasks/$taskId" params={{ taskId: task.id }} className="inline-flex items-center gap-1 text-sm text-neutral-400 hover:text-neutral-50"><ArrowLeft className="h-4 w-4" /> Voltar</Link>
      <h1 className="text-2xl font-bold tracking-tight">Editar tarefa</h1>
      <form onSubmit={onSubmit} className="card space-y-4">
        <div className="space-y-1"><label htmlFor="title">Título</label><input id="title" name="title" defaultValue={task.title} required minLength={2} maxLength={200} /></div>
        <div className="space-y-1"><label htmlFor="description">Descrição</label><textarea id="description" name="description" rows={3} defaultValue={task.description ?? ''} maxLength={2000} /></div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="space-y-1"><label htmlFor="basePoints">Pontos</label><input id="basePoints" name="basePoints" type="number" min={1} max={10000} defaultValue={task.basePoints} required /></div>
          <div className="space-y-1"><label htmlFor="estimatedMinutes">Estimativa (min)</label><input id="estimatedMinutes" name="estimatedMinutes" type="number" min={1} max={1440} defaultValue={Math.round(task.estimatedSeconds / 60)} required /></div>
          <div className="space-y-1">
            <label htmlFor="priority">Prioridade</label>
            <select id="priority" name="priority" defaultValue={task.priority}>
              {Object.entries(PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="space-y-1"><label htmlFor="dueDate">Prazo</label><input id="dueDate" name="dueDate" type="date" defaultValue={task.dueDate ?? ''} /></div>
        </div>
        <div className="space-y-1">
          <label htmlFor="assignedToId">Responsável {task.status !== 'pending' && <span className="normal-case text-neutral-600">(só pendentes podem ser reatribuídas)</span>}</label>
          <select id="assignedToId" name="assignedToId" defaultValue={task.assignedToId ?? ''} disabled={task.status !== 'pending'}>
            <option value="">Pool da equipe</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        {teamBoards.length > 0 && (
          <div className="space-y-1">
            <label htmlFor="boardId">Board</label>
            <select id="boardId" name="boardId" defaultValue={task.boardId ?? ''}>
              <option value="">Sem board</option>
              {teamBoards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1"><label htmlFor="scheduledStart">Cronograma: início</label><input id="scheduledStart" name="scheduledStart" type="date" defaultValue={task.scheduledStart ?? ''} /></div>
          <div className="space-y-1"><label htmlFor="scheduledEnd">Cronograma: fim</label><input id="scheduledEnd" name="scheduledEnd" type="date" defaultValue={task.scheduledEnd ?? ''} /></div>
        </div>
        {error && <p className="text-sm text-rose-400">{error}</p>}
        <button className="btn-primary w-full">Salvar</button>
      </form>

      <section className="card space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-300"><Link2 className="h-4 w-4" /> Depende de</h2>
        <ul className="space-y-1">
          {deps.deps.map((d) => (
            <li key={d.id} className="flex items-center justify-between rounded-lg border border-neutral-800 px-3 py-2 text-sm">
              <span className={d.status === 'finished' ? 'text-neutral-500 line-through' : ''}>{d.title}</span>
              <button onClick={() => dep(() => removeDependency({ data: { taskId: task.id, dependsOnTaskId: d.id } }))} className="text-neutral-500 hover:text-rose-400" title="Remover"><X className="h-4 w-4" /></button>
            </li>
          ))}
          {deps.deps.length === 0 && <li className="text-sm text-neutral-500">Nenhuma dependência.</li>}
        </ul>
        {deps.candidates.length > 0 && (
          <select
            value=""
            onChange={(e) => e.target.value && dep(() => addDependency({ data: { taskId: task.id, dependsOnTaskId: e.target.value } }))}
          >
            <option value="">+ adicionar dependência…</option>
            {deps.candidates.map((c) => <option key={c.id} value={c.id}>{c.title}{c.status === 'finished' ? ' (concluída)' : ''}</option>)}
          </select>
        )}
      </section>
    </div>
  )
}
