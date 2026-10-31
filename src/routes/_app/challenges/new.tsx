import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import * as React from 'react'
import { shareableTeams } from '#/components/challenges/model'
import { TeamCheckboxes } from '#/components/teams/TeamCheckboxes'
import { messageOf } from '#/components/useAttempt'
import { appRoute } from '#/lib/app-route'
import { MAX_CHALLENGE_BASE_POINTS, MAX_SCORED_ATTEMPTS_PER_DAY } from '#/lib/challenge'
import { createChallenge } from '#/server/challenges'
import { getMyTeamOptions } from '#/server/leads'
import { can, defaultTeamId, isAdmin } from '#/server/roles'
import { getTaskFormOptions } from '#/server/tasks'

export const Route = createFileRoute('/_app/challenges/new')({
  staticData: { pageWidth: 'narrow' },
  loader: async () => {
    const [mine, managed] = await Promise.all([getMyTeamOptions(), getTaskFormOptions()])
    return { myTeams: mine.teams, managedTeams: managed.teams }
  },
  component: NewChallenge,
})

function NewChallenge() {
  const { myTeams, managedTeams } = Route.useLoaderData()
  const { me } = appRoute.useRouteContext()
  const router = useRouter()
  const ownerOptions = myTeams.filter((t) => can(me, 'challenge.write', t.id))
  const [ownerId, setOwnerId] = React.useState(defaultTeamId(me, ownerOptions))
  const [tenantWide, setTenantWide] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const shareable = shareableTeams(me, managedTeams, ownerId)
  const canShareTenantWide = isAdmin(me)

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
          teamId: ownerId,
          teamIds: f.getAll('teamIds').map(String),
          tenantWide: canShareTenantWide && tenantWide,
        },
      })
      await router.invalidate()
      router.navigate({ to: '/challenges/$challengeId', params: { challengeId: c.id } })
    } catch (err) {
      setError(messageOf(err, 'Erro ao criar'))
      setBusy(false)
    }
  }

  if (ownerOptions.length === 0) return <p className="card text-sm text-neutral-400">Você precisa estar em uma equipe pra criar desafios.</p>

  return (
    <div className="space-y-4">
      <Link to="/challenges" className="inline-flex items-center gap-1 text-sm text-neutral-400 hover:text-neutral-50"><ArrowLeft className="h-4 w-4" /> Desafios</Link>
      <h1 className="text-2xl font-bold tracking-tight">Novo desafio</h1>
      <form onSubmit={onSubmit} className="card space-y-4">
        <div className="space-y-1"><label htmlFor="title">Título</label><input id="title" name="title" required minLength={2} maxLength={200} placeholder="Ex: Processar 20 pedidos" /></div>
        <div className="space-y-1"><label htmlFor="description">Descrição / regras</label><textarea id="description" name="description" rows={3} maxLength={2000} /></div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="space-y-1"><label htmlFor="basePoints">Pontos base (máx. {MAX_CHALLENGE_BASE_POINTS})</label><input id="basePoints" name="basePoints" type="number" min={1} max={MAX_CHALLENGE_BASE_POINTS} defaultValue={20} required /></div>
          <div className="space-y-1"><label htmlFor="estimatedMinutes">Meta (min)</label><input id="estimatedMinutes" name="estimatedMinutes" type="number" min={1} max={1440} defaultValue={30} required /></div>
          <div className="space-y-1"><label htmlFor="scoredAttemptsPerDay">Tentativas pontuadas por dia</label><input id="scoredAttemptsPerDay" name="scoredAttemptsPerDay" type="number" min={1} max={MAX_SCORED_ATTEMPTS_PER_DAY} defaultValue={1} required /></div>
        </div>
        <div className="space-y-1">
          <label htmlFor="teamId">Equipe dona</label>
          <select id="teamId" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
            {ownerOptions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <p className="text-xs text-neutral-500">A equipe dona valida os pontos de todas as tentativas, inclusive as de equipes com quem você compartilhar.</p>
        </div>
        {(shareable.length > 0 || canShareTenantWide) && (
          <div className="space-y-3">
            {shareable.length > 0 && <TeamCheckboxes legend="Compartilhar com" teams={shareable} selected={[]} />}
            {canShareTenantWide && (
              <label className="flex items-center gap-2 text-sm text-neutral-200">
                <input type="checkbox" checked={tenantWide} onChange={(e) => setTenantWide(e.target.checked)} className="h-4 w-4 p-0 accent-xp-400" /> Todo o tenant
              </label>
            )}
          </div>
        )}
        {error && <p role="alert" className="text-sm text-rose-400">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>Criar desafio</button>
      </form>
    </div>
  )
}
