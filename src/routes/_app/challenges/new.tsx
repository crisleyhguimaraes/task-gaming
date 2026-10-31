import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import * as React from 'react'
import { MAX_CHALLENGE_BASE_POINTS, MAX_SCORED_ATTEMPTS_PER_DAY } from '#/lib/challenge'
import { createChallenge } from '#/server/challenges'
import { getMyTeamOptions } from '#/server/leads'

export const Route = createFileRoute('/_app/challenges/new')({
  loader: () => getMyTeamOptions(),
  component: NewChallenge,
})

function NewChallenge() {
  const { teams: myTeams } = Route.useLoaderData()
  const router = useRouter()
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    setBusy(true)
    try {
      const c = await createChallenge({
        data: {
          title: String(f.get('title')),
          description: String(f.get('description') ?? ''),
          basePoints: Number(f.get('basePoints')),
          estimatedMinutes: Number(f.get('estimatedMinutes')),
          scoredAttemptsPerDay: Number(f.get('scoredAttemptsPerDay')),
          teamId: String(f.get('teamId')),
        },
      })
      await router.invalidate()
      router.navigate({ to: '/challenges/$challengeId', params: { challengeId: c.id } })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar')
      setBusy(false)
    }
  }

  if (myTeams.length === 0) return <p className="card text-sm text-neutral-400">Você precisa estar em uma equipe pra criar desafios.</p>

  return (
    <div className="space-y-4">
      <Link to="/challenges" className="inline-flex items-center gap-1 text-sm text-neutral-400 hover:text-neutral-50"><ArrowLeft className="h-4 w-4" /> Desafios</Link>
      <h1 className="text-2xl font-bold tracking-tight">Novo desafio</h1>
      <form onSubmit={onSubmit} className="card space-y-4">
        <div className="space-y-1"><label htmlFor="title">Título</label><input id="title" name="title" required minLength={2} maxLength={200} placeholder="Ex: Processar 20 pedidos" /></div>
        <div className="space-y-1"><label htmlFor="description">Descrição / regras</label><textarea id="description" name="description" rows={3} maxLength={2000} /></div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="space-y-1"><label htmlFor="basePoints">Pontos</label><input id="basePoints" name="basePoints" type="number" min={1} max={MAX_CHALLENGE_BASE_POINTS} defaultValue={20} required /></div>
          <div className="space-y-1"><label htmlFor="estimatedMinutes">Meta (min)</label><input id="estimatedMinutes" name="estimatedMinutes" type="number" min={1} max={1440} defaultValue={30} required /></div>
          <div className="space-y-1"><label htmlFor="scoredAttemptsPerDay">Tentativas pontuadas por dia</label><input id="scoredAttemptsPerDay" name="scoredAttemptsPerDay" type="number" min={1} max={MAX_SCORED_ATTEMPTS_PER_DAY} defaultValue={1} required /></div>
          <div className="space-y-1">
            <label htmlFor="teamId">Equipe</label>
            <select id="teamId" name="teamId" defaultValue={myTeams[0]?.id}>
              {myTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        </div>
        {error && <p className="text-sm text-rose-400">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>Criar desafio</button>
      </form>
    </div>
  )
}
