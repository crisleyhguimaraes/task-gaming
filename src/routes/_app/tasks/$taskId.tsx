import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { ArrowLeft, Ban, Lock, Pencil, RotateCcw, Undo2 } from 'lucide-react'
import * as React from 'react'
import { AuditEntry } from '#/components/AuditEntry'
import { CompletionModal } from '#/components/CompletionModal'
import type { CompletionSummary } from '#/components/CompletionModal'
import { Notes } from '#/components/Notes'
import { TaskPlayer } from '#/components/TaskPlayer'
import { appRoute } from '#/lib/app-route'
import { getTaskHistory } from '#/server/audit'
import { listNotes } from '#/server/notes'
import { can } from '#/server/roles'
import { cancelTask, finishTask, getTask, pauseTask, restoreTask, returnToPool, startTask } from '#/server/tasks'

export const Route = createFileRoute('/_app/tasks/$taskId')({
  loader: async ({ params }) => {
    const target = { type: 'task', id: params.taskId } as const
    const task = await getTask({ data: { taskId: params.taskId } })
    const [notes, history] = await Promise.all([listNotes({ data: target }), task.canManage ? getTaskHistory({ data: { taskId: params.taskId } }) : null])
    return { task, notes, history }
  },
  component: TaskPage,
})

function TaskPage() {
  const { task, notes, history } = Route.useLoaderData()
  return (
    <div className="space-y-8">
      <Player task={task} />
      <Notes target={{ type: 'task', id: task.id }} notes={notes} />
      {history && <TaskHistory events={history} />}
    </div>
  )
}

function TaskHistory({ events }: { events: Awaited<ReturnType<typeof getTaskHistory>> }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-neutral-300">Histórico</h2>
      <ul className="divide-y divide-neutral-800 rounded-2xl border border-neutral-800">
        {events.map((e) => <li key={e.id}><AuditEntry event={e} showEntity={false} /></li>)}
        {events.length === 0 && <li className="px-4 py-6 text-center text-sm text-neutral-500">Sem eventos registrados.</li>}
      </ul>
    </section>
  )
}

function Player({ task }: { task: Awaited<ReturnType<typeof getTask>> }) {
  const { me } = appRoute.useRouteContext()
  const router = useRouter()
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [summary, setSummary] = React.useState<CompletionSummary | null>(null)

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await router.invalidate()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro')
    } finally {
      setBusy(false)
    }
  }
  const data = { taskId: task.id }

  // O modal fica fora do ramo: após concluir, a tarefa recarrega como 'finished' e o resumo precisa continuar visível.
  const completion = <CompletionModal summary={summary} onClose={() => router.navigate({ to: '/' })} />

  if (task.status === 'finished' || task.status === 'cancelled') {
    return (
      <div className="card space-y-2 text-center">
        <p className="text-lg font-semibold">{task.title}</p>
        <p className="text-sm text-neutral-400">
          {task.status === 'finished' ? `Concluída · ${task.awardedPoints ?? 0} pts${task.needsValidation ? ' (aguardando validação)' : ''}` : 'Cancelada'}
        </p>
        {error && <p className="text-sm text-rose-400">{error}</p>}
        <div className="flex justify-center gap-2">
          <Link to="/" className="btn-ghost">Voltar para Hoje</Link>
          {task.status === 'cancelled' && !task.challengeId && task.canManage && can(me, 'task.restore', task.teamId) && (
            <button onClick={() => run(() => restoreTask({ data }))} disabled={busy} className="btn-primary">
              <RotateCcw className="h-4 w-4" /> Restaurar
            </button>
          )}
        </div>
        {completion}
      </div>
    )
  }

  return (
    <div>
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-neutral-400 hover:text-neutral-50">
        <ArrowLeft className="h-4 w-4" /> Hoje
      </Link>
      {task.assigneeName && !task.isMine && (
        <p className="mt-2 text-xs text-neutral-500">Responsável: {task.assigneeName}</p>
      )}
      {task.blockedBy.length > 0 && (
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-rose-900/50 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Bloqueada por: {task.blockedBy.map((b) => b.title).join(', ')}</span>
        </p>
      )}
      {error && <p className="mt-3 rounded-lg border border-rose-900/50 bg-rose-950/40 px-3 py-2 text-sm text-rose-400">{error}</p>}
      <TaskPlayer
        task={task}
        busy={busy || task.blockedBy.length > 0}
        readOnly={task.challengeId !== null && !task.isMine}
        onStart={() => run(() => startTask({ data }))}
        onPause={() => run(() => pauseTask({ data }))}
        onFinish={() => run(async () => setSummary(await finishTask({ data })))}
      />
      <div className="mt-4 flex justify-center gap-2 text-xs">
        {!task.challengeId && task.status !== 'pending' && (task.isMine || task.canManage) && (
          <button onClick={() => confirm('Devolver ao pool? Seu tempo fica no histórico.') && run(() => returnToPool({ data }).then(() => router.navigate({ to: '/' })))} disabled={busy} className="btn-ghost px-3 py-1.5 text-neutral-400">
            <Undo2 className="h-3.5 w-3.5" /> Devolver ao pool
          </button>
        )}
        {task.canManage && !task.challengeId && (
          <Link to="/tasks/edit/$taskId" params={{ taskId: task.id }} className="btn-ghost px-3 py-1.5 text-neutral-400"><Pencil className="h-3.5 w-3.5" /> Editar</Link>
        )}
        {(task.canManage || task.managesAttempt) && (
          <button onClick={() => confirm('Cancelar esta tarefa? Não gera pontos.') && run(() => cancelTask({ data }))} disabled={busy} className="btn-ghost px-3 py-1.5 text-neutral-400">
            <Ban className="h-3.5 w-3.5" /> Cancelar
          </button>
        )}
      </div>
      {completion}
    </div>
  )
}
