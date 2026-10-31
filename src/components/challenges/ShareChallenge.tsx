import { useRouter } from '@tanstack/react-router'
import { Share2 } from 'lucide-react'
import * as React from 'react'
import { Modal } from '#/components/Modal'
import type { TeamRef } from '#/components/teams/model'
import { TeamCheckboxes } from '#/components/teams/TeamCheckboxes'
import { messageOf } from '#/components/useAttempt'
import { nextSharedTeamIds } from '#/lib/challenge-sharing'
import { setChallengeTeams } from '#/server/challenges'

type Props = {
  challenge: { id: string; tenantWide: boolean; sharedTeams: ReadonlyArray<TeamRef> }
  manageable: ReadonlyArray<TeamRef>
  canShareTenantWide: boolean
}

export function ShareChallenge(props: Props) {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" className="btn-ghost w-full">
        <Share2 className="h-4 w-4" /> Compartilhar
      </button>
      <Modal open={open} onClose={() => setOpen(false)}>
        <ShareForm {...props} onClose={() => setOpen(false)} />
      </Modal>
    </>
  )
}

function ShareForm({ challenge, manageable, canShareTenantWide, onClose }: Props & { onClose: () => void }) {
  const router = useRouter()
  const manageableIds = manageable.map((t) => t.id)
  const currentIds = challenge.sharedTeams.map((t) => t.id)
  const foreign = challenge.sharedTeams.filter((t) => !manageableIds.includes(t.id))
  const [tenantWide, setTenantWide] = React.useState(challenge.tenantWide)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const picked = new FormData(e.currentTarget).getAll('teamIds').map(String)
    setBusy(true)
    try {
      await setChallengeTeams({ data: { challengeId: challenge.id, teamIds: nextSharedTeamIds(currentIds, manageableIds, picked), tenantWide } })
      onClose()
      await router.invalidate()
    } catch (err) {
      setError(messageOf(err, 'Erro ao compartilhar'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-3xl border border-neutral-800 bg-neutral-950 p-6">
      <h2 className="text-lg font-bold">Compartilhar desafio</h2>
      <p className="text-sm text-neutral-400">As equipes marcadas passam a competir. Os pontos continuam sendo validados pela equipe dona.</p>
      {manageable.length > 0 && <TeamCheckboxes legend="Equipes que competem" teams={manageable} selected={challenge.sharedTeams} />}
      {foreign.length > 0 && (
        <p className="text-xs text-neutral-500">Também competem, de outros líderes: {foreign.map((t) => t.name).join(', ')}. Só o administrador altera essas.</p>
      )}
      {canShareTenantWide && (
        <label className="flex items-start gap-2 text-sm text-neutral-200">
          <input type="checkbox" checked={tenantWide} onChange={(e) => setTenantWide(e.target.checked)} className="mt-0.5 h-4 w-4 p-0 accent-xp-400" />
          <span>
            Todo o tenant
            <span className="block text-xs text-neutral-500">Todas as equipes da empresa competem, inclusive as criadas depois.</span>
          </span>
        </label>
      )}
      {error && <p role="alert" className="text-sm text-rose-400">{error}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onClose} className="btn-ghost">Cancelar</button>
        <button disabled={busy} className="btn-primary">Salvar</button>
      </div>
    </form>
  )
}
