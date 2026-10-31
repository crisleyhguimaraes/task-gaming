import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { CalendarDays, CheckCircle2, ChevronRight, Clock, Flame, Hand, Medal, Play, Plus, Trophy } from 'lucide-react'
import * as React from 'react'
import { Avatar } from '#/components/Avatar'
import { ChallengeCard } from '#/components/ChallengeCard'
import { LevelTrack } from '#/components/LevelTrack'
import { PointsChart } from '#/components/PointsChart'
import { Ring } from '#/components/Ring'
import { Pill, StatTile } from '#/components/StatTile'
import { appRoute } from '#/lib/app-route'
import { displayRole, fmtClock, fmtDuration } from '#/lib/format'
import { useElapsed } from '#/lib/useElapsed'
import { isManager } from '#/server/auth-context'
import { levelFor } from '#/server/levels'
import { getToday, startTask } from '#/server/tasks'

export const Route = createFileRoute('/_app/')({
  loader: () => getToday(),
  component: Today,
})

function Today() {
  const { me } = appRoute.useRouteContext()
  const d = Route.useLoaderData()
  const router = useRouter()
  const [error, setError] = React.useState<string | null>(null)
  const level = levelFor(d.totalPoints)
  const goalPct = Math.min(100, Math.round((d.progress.points / d.settings.dailyGoalPoints) * 100))
  const manager = isManager(me)

  async function pull(taskId: string) {
    try {
      await startTask({ data: { taskId } })
      await router.invalidate()
      router.navigate({ to: '/tasks/$taskId', params: { taskId } })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro')
      router.invalidate()
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Pill icon={Medal} tone="gold" label="Nível" value={`${level.level} · ${level.name}`} />
        <Pill icon={CalendarDays} tone="cyan" label="Na empresa" value={`${d.daysInCompany} dia${d.daysInCompany === 1 ? '' : 's'}`} />
        <Pill icon={Flame} tone="green" label="Sequência" value={d.streak > 0 ? `${d.streak} ${d.streak === 1 ? 'dia seguido' : 'dias seguidos'}` : 'Comece hoje'} />
      </div>

      <section className="card grid items-center gap-6 p-5 lg:grid-cols-[auto_1fr_auto]">
        <Ring pct={level.pct} size={168} stroke={12}>
          <span className="text-2xl font-bold">Nível {level.level}</span>
          <span className="text-sm text-neutral-400">{level.next ? `${d.totalPoints - level.min}/${level.next - level.min} pts` : `${d.totalPoints} pts`}</span>
        </Ring>
        <div className="space-y-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{me.name}</h1>
            <p className="text-sm text-neutral-400">
              {displayRole(me)}{d.teams.length > 0 ? ` · ${d.teams.map((t) => t.name).join(', ')}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-6">
            <Stat label="Ritmo" value={`${d.hero.ritmo}%`} hint="dentro do estimado" />
            <Stat label="Foco" value={`${d.hero.foco}%`} hint="ativo / decorrido" />
            <Stat label="Recordes" value={d.hero.recordes} hint="desafios liderando" />
          </div>
          <div className="flex gap-2">
            <Link to="/board" className="btn-ghost px-3 py-2 text-xs">Ver board</Link>
            {manager && <Link to="/tasks/new" className="btn-primary px-3 py-2 text-xs"><Plus className="h-4 w-4" /> Nova tarefa</Link>}
          </div>
        </div>
        <div className="flex items-center gap-4 lg:flex-col lg:items-center lg:text-center">
          <Ring pct={goalPct} size={120} stroke={10} className="text-cyan-400">
            <span className="text-xl font-bold">{goalPct}%</span>
            <span className="text-xs text-neutral-400">da meta</span>
          </Ring>
          <div>
            <div className="text-sm text-neutral-400">Hoje</div>
            <div className="text-lg font-semibold">{d.progress.points} / {d.settings.dailyGoalPoints} pts</div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile icon={CheckCircle2} tone="green" value={d.progress.finished} label="Concluídas hoje" />
        <StatTile icon={Clock} tone="cyan" value={fmtDuration(d.progress.movingSeconds)} label="Tempo ativo hoje" />
        <StatTile icon={Flame} tone="violet" value={d.totalPoints} label="Pontos totais" />
        <StatTile icon={Hand} tone="pink" value={d.pool.length} label="No pool da equipe" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          {d.active && <ActiveCard task={d.active} />}

          <section className="card space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Minha fila</h2>
              <span className="text-xs text-neutral-500">{d.queue.length} tarefa{d.queue.length === 1 ? '' : 's'}</span>
            </div>
            {d.queue.length === 0 && !d.active && (
              <p className="rounded-xl bg-neutral-950/50 px-4 py-6 text-center text-sm text-neutral-400">
                Nada na fila. {manager ? 'Crie uma tarefa ou puxe uma do pool.' : 'Puxe uma tarefa do pool ou aguarde seu líder.'}
              </p>
            )}
            <ul className="space-y-2">
              {d.queue.map((t) => (
                <li key={t.id}>
                  <Link to="/tasks/$taskId" params={{ taskId: t.id }} className="flex items-center gap-3 rounded-xl bg-neutral-950/50 px-3 py-2.5 hover:bg-neutral-800/60">
                    <span className={t.status === 'paused' ? 'tile-gold h-9 w-9' : 'tile-violet h-9 w-9'}><Play className="h-4 w-4 fill-current" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{t.title}</div>
                      <div className="text-xs text-neutral-400">meta {fmtClock(t.estimatedSeconds)}{t.status === 'paused' ? ' · pausada' : ''}</div>
                    </div>
                    <span className="text-sm font-semibold text-xp-400">{t.basePoints} pts</span>
                    <ChevronRight className="h-4 w-4 text-neutral-600" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          {d.pool.length > 0 && (
            <section className="card space-y-3">
              <h2 className="font-semibold">Pool da equipe</h2>
              {error && <p className="text-sm text-rose-400">{error}</p>}
              <ul className="space-y-2">
                {d.pool.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 rounded-xl bg-neutral-950/50 px-3 py-2.5">
                    <span className="tile-pink h-9 w-9"><Hand className="h-4 w-4" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{t.title}</div>
                      <div className="text-xs text-neutral-400">meta {fmtClock(t.estimatedSeconds)} · {t.basePoints} pts</div>
                    </div>
                    <button onClick={() => pull(t.id)} className="btn-ghost px-3 py-1.5 text-xs">Puxar</button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="card">
            <h2 className="mb-2 font-semibold">Desempenho</h2>
            <PointsChart data={d.pointsByDay} />
          </section>
        </div>

        <div className="space-y-4">
          <section className="card space-y-3">
            <h2 className="font-semibold">Equipe agora</h2>
            {d.teamNow.length === 0 && <p className="text-sm text-neutral-400">Ninguém com tarefa rodando.</p>}
            <ul className="space-y-3">
              {d.teamNow.map((a) => (
                <li key={a.taskId} className="flex items-center gap-3">
                  <Avatar name={a.name} />
                  <div className="min-w-0 text-sm">
                    <div className="truncate"><b>{a.name.split(' ')[0]}</b> está em <span className="text-neutral-300">{a.title}</span></div>
                    <div className="text-xs text-xp-400">ativo agora</div>
                  </div>
                </li>
              ))}
            </ul>
            <Link to="/team" className="block text-xs text-neutral-400 hover:text-neutral-50">Ver ranking da equipe</Link>
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <h2 className="font-semibold">Desafios</h2>
              <Link to="/challenges" className="text-xs text-neutral-400 hover:text-neutral-50">Ver todos</Link>
            </div>
            {d.challenges.length === 0 && (
              <Link to="/challenges/new" className="card flex items-center gap-3 text-sm text-neutral-400 hover:bg-neutral-800/60">
                <span className="tile-gold h-9 w-9"><Trophy className="h-4 w-4" /></span> Crie o primeiro desafio da equipe
              </Link>
            )}
            <ul className="space-y-2">
              {d.challenges.slice(0, 3).map((c) => <li key={c.id}><ChallengeCard c={c} /></li>)}
            </ul>
          </section>
        </div>
      </div>

      <section className="card space-y-3">
        <div>
          <h2 className="font-semibold">Sua jornada</h2>
          <p className="text-sm text-neutral-400">{level.next ? `Faltam ${level.toNext} pts para ${levelFor(level.next).name}.` : 'Você chegou ao nível máximo.'}</p>
        </div>
        <LevelTrack points={d.totalPoints} />
      </section>
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint: string }) {
  return (
    <div>
      <div className="text-sm text-neutral-400">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-neutral-500">{hint}</div>
    </div>
  )
}

function ActiveCard({ task }: { task: NonNullable<ReturnType<typeof Route.useLoaderData>['active']> }) {
  const { seconds } = useElapsed(task.accumulatedSeconds, task.activeStartedAt, task.cap)
  const running = task.status === 'in_progress'
  const pct = Math.min(100, Math.round((seconds / task.estimatedSeconds) * 100))
  return (
    <Link to="/tasks/$taskId" params={{ taskId: task.id }} className="card flex items-center gap-4 border border-xp-500/30 bg-gradient-to-r from-xp-950/40 to-neutral-900 hover:from-xp-950/60">
      <Ring pct={pct} size={64} stroke={6} className={seconds > task.estimatedSeconds ? 'text-rose-400' : 'text-xp-400'}>
        {running ? <span className="h-2 w-2 animate-pulse rounded-full bg-xp-400" /> : <span className="text-xs text-neutral-400">II</span>}
      </Ring>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold text-xp-400">{running ? 'Em andamento' : 'Pausada'}</div>
        <div className="truncate font-medium">{task.title}</div>
        <div className="text-xs text-neutral-400">meta {fmtClock(task.estimatedSeconds)}</div>
      </div>
      <div className="text-2xl font-bold tabular-nums">{fmtClock(seconds)}</div>
    </Link>
  )
}
