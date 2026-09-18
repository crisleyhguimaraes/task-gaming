import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { ArrowLeft, Ban, Lock, Pencil, Undo2 } from 'lucide-react'
import * as React from 'react'
import { CompletionModal } from '#/components/CompletionModal'
import type { CompletionSummary } from '#/components/CompletionModal'
import { TaskPlayer } from '#/components/TaskPlayer'
import { cancelTask, finishTask, getTask, pauseTask, returnToPool, startTask } from '#/server/tasks'

export const Route = createFileRoute('/_app/tasks/$taskId')({
  loader: ({ params }) => getTask({ data: { taskId: params.taskId } }),
  component: Player,
})

function Player() {
  const task = Route.useLoaderData()
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
        <Link to="/" className="btn-ghost">Voltar para Hoje</Link>
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
        {task.canManage && (
          <button onClick={() => confirm('Cancelar esta tarefa? Não gera pontos.') && run(() => cancelTask({ data }))} disabled={busy} className="btn-ghost px-3 py-1.5 text-neutral-400">
            <Ban className="h-3.5 w-3.5" /> Cancelar
          </button>
        )}
      </div>
      {completion}
    </div>
  )
}
