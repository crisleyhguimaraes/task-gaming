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
import { PageHeader } from '#/components/PageHeader'

export const Route = createFileRoute('/_app/settings/users')({
  staticData: { pageWidth: 'wide' },
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
    <div>
      <PageHeader title="Usuários" subtitle="Quem tem acesso, em quais equipes e com qual papel." />
      {error && <p role="alert" className="mb-4 text-sm text-rose-400">{error}</p>}
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(320px,420px)_1fr]">
        {allowedModes.length > 0 && (
          <div className="space-y-3 xl:sticky xl:top-20">
            <div className="flex gap-1 rounded-xl border border-neutral-800 bg-neutral-900 p-1 text-xs font-medium">
              {allowedModes.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={id === activeMode}
                  onClick={() => setMode(id)}
                  className={`flex-1 rounded-lg py-1.5 ${id === activeMode ? 'bg-brand-soft text-brand-ink' : 'text-neutral-400 hover:text-neutral-50'}`}
                >
                  <Icon className="mr-1 inline h-3.5 w-3.5" /> {label}
                </button>
              ))}
            </div>
            {activeMode === 'invite' && <InviteForm me={me} teams={teams} act={act} />}
            {activeMode === 'create' && <CreateUserForm me={me} teams={teams} act={act} />}
          </div>
        )}
        <div className="space-y-4">
          <PendingInvites invites={invites} act={act} />
          <ul className="card divide-y divide-neutral-800 overflow-hidden p-0">
            {users.map((u) => <UserListItem key={u.id} user={u} me={me} teams={teams} act={act} />)}
            {users.length === 0 && <li className="px-4 py-6 text-center text-sm text-neutral-500">Nenhuma pessoa por aqui ainda.</li>}
          </ul>
        </div>
      </div>
    </div>
  )
}
