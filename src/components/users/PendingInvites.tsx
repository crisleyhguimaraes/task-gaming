import { RotateCw, X } from 'lucide-react'
import type { Act } from '#/components/useAttempt'
import { roleLabel } from '#/lib/format'
import type { listInvitations } from '#/server/invitations'
import { cancelInvitation, resendInvitation } from '#/server/invitations'
import { teamRoleLabel } from './model'

type Invite = Awaited<ReturnType<typeof listInvitations>>[number]

const describe = (i: Invite) =>
  [
    i.role === 'TENANT_ADMIN' && roleLabel.TENANT_ADMIN,
    i.teamName && `${i.teamName} (${teamRoleLabel[i.teamRole]})`,
    `expira ${new Date(i.expiresAt).toLocaleDateString('pt-BR')}`,
  ]
    .filter(Boolean)
    .join(' · ')

const iconButton = 'rounded-lg p-2 text-neutral-500 hover:bg-neutral-900'

export function PendingInvites({ invites, act }: { invites: ReadonlyArray<Invite>; act: Act }) {
  if (invites.length === 0) return null
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-neutral-300">Convites pendentes</h2>
      <ul className="divide-y divide-neutral-800 rounded-2xl border border-neutral-800">
        {invites.map((i) => (
          <li key={i.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <div className="min-w-0">
              <div className="truncate text-sm">{i.email}</div>
              <div className="text-xs text-neutral-500">{describe(i)}</div>
            </div>
            <div className="flex shrink-0 gap-1">
              <button onClick={() => act(() => resendInvitation({ data: { invitationId: i.id } }))} aria-label={`Reenviar convite para ${i.email}`} title="Reenviar" className={`${iconButton} hover:text-neutral-50`}><RotateCw className="h-4 w-4" /></button>
              <button onClick={() => act(() => cancelInvitation({ data: { invitationId: i.id } }))} aria-label={`Cancelar convite para ${i.email}`} title="Cancelar" className={`${iconButton} hover:text-rose-400`}><X className="h-4 w-4" /></button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
