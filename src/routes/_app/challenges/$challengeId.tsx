import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { Archive, ArrowLeft, Flame, Trophy } from 'lucide-react'
import { AttemptButton } from '#/components/challenges/AttemptButton'
import { ChallengeRankings } from '#/components/challenges/ChallengeRankings'
import { ChallengeTeams } from '#/components/challenges/ChallengeTeams'
import { shareableTeams } from '#/components/challenges/model'
import { ShareChallenge } from '#/components/challenges/ShareChallenge'
import { appRoute } from '#/lib/app-route'
import { fmtClock } from '#/lib/format'
import { archiveChallenge, getChallenge } from '#/server/challenges'
import { isAdmin } from '#/server/roles'
import { getTaskFormOptions } from '#/server/tasks'

export const Route = createFileRoute('/_app/challenges/$challengeId')({
  loader: async ({ params }) => {
    const challenge = await getChallenge({ data: { challengeId: params.challengeId } })
    const managedTeams = challenge.canShare ? (await getTaskFormOptions()).teams : []
    return { challenge, managedTeams }
  },
  component: Challenge,
})

function Challenge() {
  const { challenge: c, managedTeams } = Route.useLoaderData()
  const { me } = appRoute.useRouteContext()
  const router = useRouter()
  const record = c.ranking[0]
  const shareable = shareableTeams(me, managedTeams, c.teamId)

  async function archive() {
    if (!confirm('Arquivar este desafio? As tentativas ficam no histórico.')) return
    await archiveChallenge({ data: { challengeId: c.id } })
    await router.invalidate()
    router.navigate({ to: '/challenges' })
  }

  return (
    <div className="space-y-5">
      <Link to="/challenges" className="inline-flex items-center gap-1 text-sm text-neutral-400 hover:text-neutral-50"><ArrowLeft className="h-4 w-4" /> Desafios</Link>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-500">
          <span className="inline-flex items-center gap-1 rounded-full border border-xp-800/40 bg-xp-950/30 px-2 py-0.5 font-semibold text-xp-400"><Flame className="h-3 w-3 fill-xp-400" /> {c.basePoints} pts</span>
          <span>meta {fmtClock(c.estimatedSeconds)}</span>
          <span>· {c.scoredAttemptsPerDay} pontuada{c.scoredAttemptsPerDay === 1 ? '' : 's'} por dia</span>
          {c.archivedAt && <span>· arquivado</span>}
        </div>
        <h1 className="text-2xl font-bold tracking-tight">{c.title}</h1>
        {c.description && <p className="text-sm text-neutral-400">{c.description}</p>}
        <ChallengeTeams ownerName={c.teamName} tenantWide={c.tenantWide} sharedTeams={c.sharedTeams} />
        <p className="text-xs text-neutral-600">
          {c.creatorName && `criado por ${c.creatorName} · `}pontos validados pelo líder da equipe {c.teamName}
        </p>
      </div>

      <div className="card flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-neutral-300">Recorde</div>
          {record ? (
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-3xl font-black text-xp-400">{fmtClock(record.best ?? 0)}</span>
              <span className="text-sm text-neutral-300">{record.name} · {record.teamName}</span>
            </div>
          ) : (
            <div className="text-sm text-neutral-400">Ninguém completou ainda. Seja o primeiro.</div>
          )}
        </div>
        <Trophy className="h-10 w-10 shrink-0 text-xp-500/40" />
      </div>

      {!c.archivedAt && <AttemptButton challengeId={c.id} openAttempt={c.openAttempt} competingTeams={c.competingTeams} me={me} />}

      <ChallengeRankings ranking={c.ranking} teamRanking={c.teamRanking} meId={me.userId} myTeamIds={me.memberships.map((m) => m.teamId)} />

      {c.canShare && !c.archivedAt && (shareable.length > 0 || isAdmin(me)) && (
        <ShareChallenge challenge={c} manageable={shareable} canShareTenantWide={isAdmin(me)} />
      )}
      {c.canEdit && !c.archivedAt && (
        <button onClick={archive} className="btn-ghost w-full text-neutral-400"><Archive className="h-4 w-4" /> Arquivar desafio</button>
      )}
    </div>
  )
}
