import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { Archive, ArrowLeft, Flame, Play, Trophy } from 'lucide-react'
import * as React from 'react'
import { Avatar } from '#/components/Avatar'
import { fmtClock } from '#/lib/format'
import { appRoute } from '#/lib/app-route'
import { archiveChallenge, attemptChallenge, getChallenge } from '#/server/challenges'

export const Route = createFileRoute('/_app/challenges/$challengeId')({
  loader: ({ params }) => getChallenge({ data: { challengeId: params.challengeId } }),
  component: Challenge,
})

function Challenge() {
  const c = Route.useLoaderData()
  const { me } = appRoute.useRouteContext()
  const router = useRouter()
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const record = c.ranking[0]

  async function attempt() {
    setBusy(true)
    try {
      const t = await attemptChallenge({ data: { challengeId: c.id } })
      await router.invalidate()
      router.navigate({ to: '/tasks/$taskId', params: { taskId: t.id } })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro')
      setBusy(false)
    }
  }
  async function archive() {
    if (!confirm('Arquivar este desafio? As tentativas ficam no histórico.')) return
    await archiveChallenge({ data: { challengeId: c.id } })
    await router.invalidate()
    router.navigate({ to: '/challenges' })
  }

  return (
    <div className="space-y-5">
      <Link to="/challenges" className="inline-flex items-center gap-1 text-sm text-neutral-400 hover:text-neutral-50"><ArrowLeft className="h-4 w-4" /> Desafios</Link>
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          <span className="inline-flex items-center gap-1 rounded-full border border-xp-800/40 bg-xp-950/30 px-2 py-0.5 font-semibold text-xp-400"><Flame className="h-3 w-3 fill-xp-400" /> {c.basePoints} pts</span>
          <span>meta {fmtClock(c.estimatedSeconds)}</span>
          <span>· {c.teamName}</span>
          {c.archivedAt && <span>· arquivado</span>}
        </div>
        <h1 className="text-2xl font-bold tracking-tight">{c.title}</h1>
        {c.description && <p className="text-sm text-neutral-400">{c.description}</p>}
        {c.creatorName && <p className="text-xs text-neutral-600">criado por {c.creatorName}</p>}
      </div>

      <div className="card flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-neutral-300">Recorde da equipe</div>
          {record ? (
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black text-xp-400">{fmtClock(record.best ?? 0)}</span>
              <span className="text-sm text-neutral-300">{record.name}</span>
            </div>
          ) : (
            <div className="text-sm text-neutral-400">Ninguém completou ainda. Seja o primeiro.</div>
          )}
        </div>
        <Trophy className="h-10 w-10 text-xp-500/40" />
      </div>

      {!c.archivedAt && (
        <button onClick={attempt} disabled={busy} className="btn-primary w-full py-4">
          <Play className="h-5 w-5 fill-current" /> {c.openAttempt ? 'Continuar minha tentativa' : 'Tentar agora'}
        </button>
      )}
      {error && <p className="text-sm text-rose-400">{error}</p>}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-neutral-300">Ranking</h2>
        <ol className="divide-y divide-neutral-800 rounded-2xl border border-neutral-800">
          {c.ranking.map((r, i) => (
            <li key={r.userId} className={`flex items-center justify-between px-4 py-3 ${r.userId === me.userId ? 'bg-xp-950/10' : ''}`}>
              <div className="flex items-center gap-3">
                <span className={`w-5 text-center text-sm font-bold ${i === 0 ? 'text-xp-400' : 'text-neutral-500'}`}>{i + 1}</span>
                <Avatar name={r.name} />
                <div>
                  <div className="text-sm font-medium">{r.name}</div>
                  <div className="text-[11px] text-neutral-500">{r.attempts} tentativa{r.attempts === 1 ? '' : 's'} · {r.points} pts</div>
                </div>
              </div>
              <span className="text-sm font-bold">{fmtClock(r.best ?? 0)}</span>
            </li>
          ))}
          {c.ranking.length === 0 && <li className="px-4 py-6 text-center text-sm text-neutral-500">Sem tempos válidos ainda.</li>}
        </ol>
      </section>

      {c.canEdit && !c.archivedAt && (
        <button onClick={archive} className="btn-ghost w-full text-neutral-400"><Archive className="h-4 w-4" /> Arquivar desafio</button>
      )}
    </div>
  )
}
