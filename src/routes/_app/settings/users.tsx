import { createFileRoute } from '@tanstack/react-router'
import { Mail, UserPlus } from 'lucide-react'
import * as React from 'react'
import { useAct } from '#/components/useAttempt'
import { CreateUserForm } from '#/components/users/CreateUserForm'
import { InviteForm } from '#/components/users/InviteForm'
import { PendingInvites } from '#/components/users/PendingInvites'
import { UserListItem } from '#/components/users/UserListItem'
import { appRoute } from '#/lib/app-route'
import { listInvitations } from '#/server/invitations'
import { can } from '#/server/roles'
import { listUsers } from '#/server/users'

export const Route = createFileRoute('/_app/settings/users')({
  loader: async ({ context: { me } }) => {
    const [data, invites] = await Promise.all([listUsers(), can(me, 'invitation.manage') ? listInvitations() : []])
    return { ...data, invites }
  },
  component: Users,
})

type Mode = 'invite' | 'create'

function Users() {
  const { me } = appRoute.useRouteContext()
  const { users, teams, invites } = Route.useLoaderData()
  const [mode, setMode] = React.useState<Mode>('invite')
  const { error, act } = useAct()

  const modes = [
    { id: 'invite', label: 'Convidar por e-mail', icon: Mail, allowed: can(me, 'invitation.manage') },
    { id: 'create', label: 'Criar com senha', icon: UserPlus, allowed: can(me, 'user.create') },
  ] as const
  const allowedModes = modes.filter((m) => m.allowed)
  const activeMode = allowedModes.find((m) => m.id === mode)?.id ?? allowedModes[0]?.id

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-neutral-400">Configurações</p>
        <h1 className="text-2xl font-bold tracking-tight">Usuários</h1>
      </div>
      {allowedModes.length > 0 && (
        <div className="flex gap-1 rounded-xl border border-neutral-800 p-1 text-xs font-medium">
          {allowedModes.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-pressed={id === activeMode}
              onClick={() => setMode(id)}
              className={`flex-1 rounded-lg py-1.5 ${id === activeMode ? 'bg-neutral-800 text-neutral-50' : 'text-neutral-400'}`}
            >
              <Icon className="mr-1 inline h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>
      )}
      {activeMode === 'invite' && <InviteForm me={me} teams={teams} act={act} />}
      {activeMode === 'create' && <CreateUserForm me={me} teams={teams} act={act} />}
      {error && <p role="alert" className="text-sm text-rose-400">{error}</p>}
      <PendingInvites invites={invites} act={act} />
      <ul className="divide-y divide-neutral-800 rounded-2xl border border-neutral-800">
        {users.map((u) => <UserListItem key={u.id} user={u} me={me} teams={teams} act={act} />)}
        {users.length === 0 && <li className="px-4 py-6 text-center text-sm text-neutral-500">Nenhuma pessoa por aqui ainda.</li>}
      </ul>
    </div>
  )
}
