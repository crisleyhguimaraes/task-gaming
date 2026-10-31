import { Link, createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { Columns3, Download, GanttChart, List, Pencil, Plus, Search } from 'lucide-react'
import * as React from 'react'
import { CompletionModal } from '#/components/CompletionModal'
import type { CompletionSummary } from '#/components/CompletionModal'
import { Modal } from '#/components/Modal'
import { KanbanBoard } from '#/components/kanban/Board'
import type { BoardTask, MovePayload } from '#/components/kanban/Board'
import { PRIORITY_LABEL } from '#/components/kanban/Card'
import { Timeline } from '#/components/Timeline'
import { fmtClock } from '#/lib/format'
import { appRoute } from '#/lib/app-route'
import { NO_BOARD } from '#/lib/boards'
import { downloadCsv } from '#/lib/download-csv'
import { listBoards } from '#/server/boards'
import { exportTasksCsv } from '#/server/exports'
import { can, isManager } from '#/server/roles'
import { finishTask, finishTaskManually, listTasks, moveTask, pauseTask, returnToPool, startTask, taskFilterSchema } from '#/server/tasks'

export const Route = createFileRoute('/_app/board')({
  validateSearch: taskFilterSchema,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const [data, boards] = await Promise.all([listTasks({ data: deps }), listBoards()])
    return { ...data, boards }
  },
  component: Board,
})

const STATUS_LABEL: Record<BoardTask['status'], string> = {
  pending: 'A fazer', in_progress: 'Em andamento', paused: 'Pausada', finished: 'Concluída', cancelled: 'Cancelada',
}
const PRIORITY_RANK = { urgent: 0, high: 1, medium: 2, low: 3 }
const STATUS_RANK = { in_progress: 0, paused: 1, pending: 2, finished: 3, cancelled: 4 }

function Board() {
  const { me } = appRoute.useRouteContext()
  const { tasks, teams, members, edges, boards } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: '/board' })
  const router = useRouter()
  const [error, setError] = React.useState<string | null>(null)
  const [summary, setSummary] = React.useState<CompletionSummary | null>(null)
  const [confirmManual, setConfirmManual] = React.useState<MovePayload | null>(null)
  const set = (patch: Partial<typeof search>) => navigate({ search: (prev) => ({ ...prev, ...patch }) })

  async function exportCsv() {
    try {
      downloadCsv(await exportTasksCsv({ data: { teamId: search.teamId, assigneeId: search.assigneeId, priority: search.priority, search: search.search } }))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao exportar')
    }
  }

  async function apply(p: MovePayload): Promise<boolean> {
    const data = { taskId: p.task.id }
    try {
      if (p.toStatus !== p.task.status) {
        if (p.toStatus === 'in_progress') await startTask({ data })
        else if (p.toStatus === 'paused') await pauseTask({ data })
        else if (p.toStatus === 'pending') await returnToPool({ data })
        else if (p.toStatus === 'finished') {
          if (p.task.status === 'in_progress') setSummary(await finishTask({ data }))
          else setSummary(await finishTaskManually({ data }))
        }
      }
      await moveTask({ data: { ...data, sortOrder: p.sortOrder } })
      setError(null)
      router.invalidate()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Transição não permitida')
      router.invalidate()
      return false
    }
  }

  function onMove(p: MovePayload) {
    // pendente/pausada → concluída: confirma conclusão manual
    if (p.toStatus === 'finished' && p.task.status !== 'in_progress') {
      setConfirmManual(p)
      return Promise.resolve(true)
    }
    if (p.task.status === 'finished' && p.toStatus !== 'finished') {
      setError('Tarefa concluída não volta pra trás')
      router.invalidate()
      return Promise.resolve(false)
    }
    return apply(p)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Board</h1>
        <div className="flex items-center gap-2">
          <div className="flex gap-0.5 rounded-xl border border-neutral-800 p-0.5">
            {([['kanban', Columns3], ['list', List], ['timeline', GanttChart]] as const).map(([v, Icon]) => (
              <button key={v} onClick={() => set({ view: v })} title={v} className={`rounded-lg p-1.5 ${search.view === v ? 'bg-neutral-800 text-neutral-50' : 'text-neutral-500 hover:text-neutral-50'}`}>
                <Icon className="h-4 w-4" />
              </button>
            ))}
          </div>
          {can(me, 'export.csv') && (
            <button onClick={exportCsv} className="btn-ghost px-3 py-2 text-xs"><Download className="h-4 w-4" /> CSV</button>
          )}
          {isManager(me) && <Link to="/tasks/new" className="btn-primary px-3 py-2 text-xs"><Plus className="h-4 w-4" /> Tarefa</Link>}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <form
          onSubmit={(e) => { e.preventDefault(); set({ search: String(new FormData(e.currentTarget).get('q')) || undefined }) }}
          className="relative min-w-[180px] flex-1"
        >
          <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-neutral-500" />
          <input name="q" defaultValue={search.search ?? ''} placeholder="Buscar…" className="pl-9" />
        </form>
        {boards.length > 0 && (
          <select value={search.boardId ?? ''} onChange={(e) => set({ boardId: e.target.value || undefined })} className="w-auto" aria-label="Board">
            <option value="">Todos os boards</option>
            <option value={NO_BOARD}>Sem board</option>
            {boards.map((b) => <option key={b.id} value={b.id}>{b.archivedAt ? `${b.name} (arquivado)` : b.name}</option>)}
          </select>
        )}
        {teams.length > 0 && (
          <select value={search.teamId ?? ''} onChange={(e) => set({ teamId: e.target.value || undefined, assigneeId: undefined })} className="w-auto">
            <option value="">Todas as equipes</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
        <select value={search.assigneeId ?? ''} onChange={(e) => set({ assigneeId: e.target.value || undefined })} className="w-auto">
          <option value="">Todos</option>
          <option value="pool">Pool</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <select value={search.priority ?? ''} onChange={(e) => set({ priority: (e.target.value || undefined) as typeof search.priority })} className="w-auto">
          <option value="">Prioridade</option>
          {Object.entries(PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      {error && <p className="rounded-lg border border-rose-900/50 bg-rose-950/40 px-3 py-2 text-sm text-rose-400">{error}</p>}

      {search.view === 'kanban' && <KanbanBoard tasks={tasks} onMove={onMove} />}
      {search.view === 'list' && <ListView tasks={tasks} sort={search.sort} onSort={(sort) => set({ sort })} />}
      {search.view === 'timeline' && <Timeline tasks={tasks} edges={edges} />}

      <Modal open={confirmManual !== null} onClose={() => { setConfirmManual(null); router.invalidate() }}>
        {confirmManual && (
          <div className="space-y-4 rounded-3xl border border-neutral-800 bg-neutral-950 p-6">
            <h2 className="text-lg font-bold">Concluir manualmente?</h2>
            <p className="text-sm text-neutral-400">
              <b className="text-neutral-200">{confirmManual.task.title}</b> nunca rodou no cronômetro. Ela recebe os {confirmManual.task.basePoints} pontos base, sem bônus de ritmo.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => { setConfirmManual(null); router.invalidate() }} className="btn-ghost">Cancelar</button>
              <button onClick={() => { const p = confirmManual; setConfirmManual(null); apply(p) }} className="btn-white">Concluir</button>
            </div>
          </div>
        )}
      </Modal>
      <CompletionModal summary={summary} onClose={() => setSummary(null)} />
    </div>
  )
}

function ListView({ tasks, sort, onSort }: { tasks: Array<BoardTask>; sort: NonNullable<ReturnType<typeof Route.useSearch>['sort']>; onSort: (s: typeof sort) => void }) {
  const sorted = [...tasks].sort((a, b) => {
    if (sort === 'priority') return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
    if (sort === 'status') return STATUS_RANK[a.status] - STATUS_RANK[b.status]
    if (sort === 'basePoints') return b.basePoints - a.basePoints
    if (sort === 'dueDate') return (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999')
    return a.title.localeCompare(b.title)
  })
  const Th = ({ k, children }: { k: typeof sort; children: React.ReactNode }) => (
    <th className="px-3 py-2 text-left text-xs font-semibold text-neutral-400">
      <button onClick={() => onSort(k)} className={`hover:text-neutral-50 ${sort === k ? 'text-xp-400' : ''}`}>{children}</button>
    </th>
  )
  return (
    <div className="overflow-x-auto rounded-2xl border border-neutral-800">
      <table className="w-full text-sm">
        <thead className="border-b border-neutral-800 bg-neutral-950/60">
          <tr>
            <Th k="title">Tarefa</Th><Th k="status">Status</Th><Th k="priority">Prioridade</Th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-neutral-400">Responsável</th>
            <Th k="dueDate">Prazo</Th><Th k="basePoints">Pts</Th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-neutral-400">Meta</th>
            <th />
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-800/80">
          {sorted.map((t) => (
            <tr key={t.id} className="hover:bg-neutral-900/60">
              <td className="px-3 py-2"><Link to="/tasks/$taskId" params={{ taskId: t.id }} className="font-medium hover:underline">{t.title}</Link></td>
              <td className="px-3 py-2 text-neutral-400">{STATUS_LABEL[t.status]}</td>
              <td className="px-3 py-2 text-neutral-400">{PRIORITY_LABEL[t.priority]}</td>
              <td className="px-3 py-2 text-neutral-400">{t.assigneeName ?? <i className="text-neutral-600">pool</i>}</td>
              <td className="px-3 py-2 text-neutral-400">{t.dueDate ?? '—'}</td>
              <td className="px-3 py-2 text-xp-400">{t.basePoints}</td>
              <td className="px-3 py-2 text-neutral-400">{fmtClock(t.estimatedSeconds)}</td>
              <td className="px-3 py-2 text-right">
                {t.canManage && t.status !== 'finished' && t.status !== 'cancelled' && (
                  <Link to="/tasks/edit/$taskId" params={{ taskId: t.id }} className="text-neutral-500 hover:text-neutral-50" title="Editar"><Pencil className="h-4 w-4" /></Link>
                )}
              </td>
            </tr>
          ))}
          {sorted.length === 0 && <tr><td colSpan={8} className="px-3 py-8 text-center text-neutral-500">Nenhuma tarefa com esses filtros.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}
