import { useRouter } from '@tanstack/react-router'
import { Play } from 'lucide-react'
import * as React from 'react'
import { Modal } from '#/components/Modal'
import { cannotCompeteReason } from '#/lib/challenge-sharing'
import { attemptChallenge } from '#/server/challenges'
import type { AuthCtx } from '#/server/roles'

type Team = { id: string; name: string }

type Props = {
  challengeId: string
  openAttempt: { id: string } | null
  competingTeams: ReadonlyArray<Team>
  me: Pick<AuthCtx, 'role' | 'memberships'>
}

export function AttemptButton({ challengeId, openAttempt, competingTeams, me }: Props) {
  const router = useRouter()
  const [choosing, setChoosing] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  if (competingTeams.length === 0) return <p className="card text-sm text-neutral-400">{cannotCompeteReason(me)}</p>

  async function attempt(teamId?: string) {
    setChoosing(false)
    setBusy(true)
    try {
      const task = await attemptChallenge({ data: { challengeId, teamId } })
      await router.invalidate()
      router.navigate({ to: '/tasks/$taskId', params: { taskId: task.id } })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro')
      setBusy(false)
    }
  }

  const needsChoice = !openAttempt && competingTeams.length > 1
  return (
    <div className="space-y-2">
      <button onClick={() => (needsChoice ? setChoosing(true) : attempt())} disabled={busy} aria-haspopup={needsChoice ? 'dialog' : undefined} className="btn-primary w-full py-4">
        <Play className="h-5 w-5 fill-current" /> {openAttempt ? 'Retomar minha tentativa' : 'Tentar agora'}
      </button>
      {error && <p role="alert" className="text-sm text-rose-400">{error}</p>}
      <Modal open={choosing} onClose={() => setChoosing(false)}>
        <ChooseTeam teams={competingTeams} onChoose={attempt} onClose={() => setChoosing(false)} />
      </Modal>
    </div>
  )
}

function ChooseTeam({ teams, onChoose, onClose }: { teams: ReadonlyArray<Team>; onChoose: (teamId: string) => void; onClose: () => void }) {
  const [teamId, setTeamId] = React.useState('')
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onChoose(teamId)
      }}
      className="space-y-4 rounded-3xl border border-neutral-800 bg-neutral-950 p-6"
    >
      <fieldset className="space-y-2">
        <legend className="text-lg font-bold">Competir por qual equipe?</legend>
        <p className="text-xs text-neutral-500">O tempo desta tentativa conta para a equipe escolhida.</p>
        {teams.map((t) => (
          <label key={t.id} className="flex items-center gap-2 text-sm text-neutral-200">
            <input type="radio" name="teamId" value={t.id} checked={teamId === t.id} onChange={() => setTeamId(t.id)} className="h-4 w-4 p-0 accent-xp-400" /> {t.name}
          </label>
        ))}
      </fieldset>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onClose} className="btn-ghost">Cancelar</button>
        <button disabled={!teamId} className="btn-primary">Começar</button>
      </div>
    </form>
  )
}
