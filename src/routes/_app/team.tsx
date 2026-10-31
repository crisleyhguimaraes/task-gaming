import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { Check, Clock, Flame, Undo2, X } from 'lucide-react'
import * as React from 'react'
import { z } from 'zod'
import { Avatar } from '#/components/Avatar'
import { fmtClock, fmtDuration } from '#/lib/format'
import { appRoute } from '#/lib/app-route'
import { getTeam, returnToPool, validatePoints } from '#/server/tasks'

const searchSchema = z.object({ period: z.enum(['day', 'week', 'all']).default('week'), teamId: z.uuid().optional() })

export const Route = createFileRoute('/_app/team')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getTeam({ data: deps }),
  component: Team,
})

const PERIODS = [
  ['day', 'Hoje'],
  ['week', 'Semana'],
  ['all', 'Geral'],
] as const

function Team() {
  const { me } = appRoute.useRouteContext()
  const data = Route.useLoaderData()
  const { period, teamId } = Route.useSearch()
  const router = useRouter()
  const [error, setError] = React.useState<string | null>(null)

  // Feed "ativos agora": polling simples, só nesta página.
  React.useEffect(() => {
    const t = setInterval(() => router.invalidate(), 15000)
    return () => clearInterval(t)
  }, [router])

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
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Equipe</h1>
        <div className="flex gap-1 rounded-xl border border-neutral-800 p-1">
          {PERIODS.map(([p, label]) => (
            <Link key={p} to="/team" search={{ period: p, teamId }} className={`rounded-lg px-3 py-1 text-xs font-medium ${period === p ? 'bg-neutral-800 text-neutral-50' : 'text-neutral-400'}`}>
              {label}
            </Link>
          ))}
        </div>
      </div>
      {data.teams.length > 0 && (
        <div className="flex flex-wrap gap-1">
          <Link to="/team" search={{ period }} className={`rounded-lg px-3 py-1 text-xs ${!teamId ? 'bg-neutral-800 text-neutral-50' : 'text-neutral-400'}`}>Todas as equipes</Link>
          {data.teams.map((t) => (
            <Link key={t.id} to="/team" search={{ period, teamId: t.id }} className={`rounded-lg px-3 py-1 text-xs ${teamId === t.id ? 'bg-neutral-800 text-neutral-50' : 'text-neutral-400'}`}>{t.name}</Link>
          ))}
          {teamId && <Link to="/teams/$teamId" params={{ teamId }} className="rounded-lg px-3 py-1 text-xs text-neutral-400 underline hover:text-neutral-50">Detalhes da equipe</Link>}
        </div>
      )}

      {data.feed && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-neutral-300">Ativos agora</h2>
          {data.feed.activeNow.length === 0 && <p className="card text-sm text-neutral-500">Ninguém com tarefa rodando.</p>}
          <ul className="space-y-2">
            {data.feed.activeNow.map((a) => (
              <li key={a.taskId}>
                <Link to="/tasks/$taskId" params={{ taskId: a.taskId }} className="card flex items-center justify-between gap-3 hover:bg-neutral-800/60">
                  <Avatar name={a.name} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-xp-400">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> {a.name}
                    </div>
                    <div className="truncate text-sm">{a.title}</div>
                  </div>
                  <Since since={a.since} />
                </Link>
              </li>
            ))}
          </ul>
          {data.feed.poolCount > 0 && <p className="text-xs text-neutral-500">{data.feed.poolCount} tarefa(s) no pool esperando alguém puxar.</p>}
        </section>
      )}

      {data.feed && data.canManage && data.feed.pendingValidation.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-amber-300">Aguardando validação</h2>
          <ul className="space-y-2">
            {data.feed.pendingValidation.map((p) => (
              <li key={p.taskId} className="card flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{p.title}</div>
                  <div className="text-xs text-neutral-500">
                    {p.name} · {fmtClock(p.movingSeconds ?? 0)} de {fmtClock(p.estimatedSeconds)} · {p.points} pts
                  </div>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => act(() => validatePoints({ data: { taskId: p.taskId, approve: true } }))} className="btn-primary px-3 py-1.5 text-xs" title="Aprovar"><Check className="h-4 w-4" /></button>
                  <button onClick={() => act(() => validatePoints({ data: { taskId: p.taskId, approve: false } }))} className="btn-ghost px-3 py-1.5 text-xs" title="Rejeitar (0 pts)"><X className="h-4 w-4" /></button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.feed && data.canManage && data.feed.paused.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-neutral-300">Pausadas</h2>
          <ul className="space-y-2">
            {data.feed.paused.map((p) => (
              <li key={p.taskId} className="card flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{p.title}</div>
                  <div className="text-xs text-neutral-500">{p.name}</div>
                </div>
                <button onClick={() => act(() => returnToPool({ data: { taskId: p.taskId } }))} className="btn-ghost px-3 py-1.5 text-xs"><Undo2 className="h-4 w-4" /> Devolver ao pool</button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {error && <p className="text-sm text-rose-400">{error}</p>}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-neutral-300">Ranking</h2>
        <ol className="divide-y divide-neutral-800 rounded-2xl border border-neutral-800">
          {data.ranking.map((r, i) => (
            <li key={`${r.teamId}:${r.userId}`} className={`flex items-center justify-between px-4 py-3 ${r.userId === me.userId ? 'bg-xp-950/10' : ''}`}>
              <div className="flex items-center gap-3">
                <span className={`w-5 text-center text-sm font-bold ${i === 0 && r.points > 0 ? 'text-xp-400' : 'text-neutral-500'}`}>{i + 1}</span>
                <Avatar name={r.name} />
                <div>
                  <div className="text-sm font-medium">{r.name}</div>
                  <div className="text-[11px] text-neutral-500">
                    {r.teamName} · {r.finished} concluída{r.finished === 1 ? '' : 's'} · <Clock className="inline h-3 w-3" /> {fmtDuration(r.movingSeconds)}
                  </div>
                </div>
              </div>
              <span className="flex items-center gap-1 text-sm font-bold text-xp-400"><Flame className="h-3.5 w-3.5 fill-xp-400" /> {r.points}</span>
            </li>
          ))}
          {data.ranking.length === 0 && <li className="px-4 py-6 text-center text-sm text-neutral-500">Ninguém na equipe ainda.</li>}
        </ol>
      </section>
    </div>
  )
}

function Since({ since }: { since: Date | string }) {
  const [now, setNow] = React.useState<number | null>(null)
  React.useEffect(() => {
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const secs = now ? Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000)) : 0
  return <span className="text-sm tabular-nums text-neutral-300">{fmtClock(secs)}</span>
}
