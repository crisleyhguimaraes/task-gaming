import { Mail } from 'lucide-react'
import type { FormEvent } from 'react'
import type { Act } from '#/components/useAttempt'
import type { AuthCtx } from '#/server/roles'
import { createInvitation } from '#/server/invitations'
import type { Team } from './model'
import { readPlacement } from './model'
import { PlacementFields } from './PlacementFields'

export function InviteForm({ me, teams, act }: { me: AuthCtx; teams: ReadonlyArray<Team>; act: Act }) {
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const f = new FormData(form)
    act(() => createInvitation({ data: { email: String(f.get('email')), ...readPlacement(f) } }).then(() => form.reset()))
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1 sm:col-span-2"><label htmlFor="email">E-mail</label><input id="email" name="email" type="email" required /></div>
        <PlacementFields me={me} teams={teams} capability="invitation.manage" />
      </div>
      <p className="text-xs text-neutral-500">A pessoa recebe um link válido por 7 dias e define a própria senha.</p>
      <button className="btn-primary"><Mail className="h-4 w-4" /> Enviar convite</button>
    </form>
  )
}
