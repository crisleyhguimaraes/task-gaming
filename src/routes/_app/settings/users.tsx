import { createFileRoute, useRouter } from '@tanstack/react-router'
import { Mail, RotateCw, UserPlus, X } from 'lucide-react'
import * as React from 'react'
import { roleLabel } from '#/lib/format'
import { appRoute } from '#/lib/app-route'
import { cancelInvitation, createInvitation, listInvitations, resendInvitation } from '#/server/invitations'
import { createUser, listUsers, updateUser } from '#/server/users'

export const Route = createFileRoute('/_app/settings/users')({
  loader: async () => {
    const [data, invites] = await Promise.all([listUsers(), listInvitations()])
    return { ...data, invites }
  },
  component: Users,
})

const ROLES = ['MEMBER', 'TEAM_LEADER', 'TENANT_ADMIN'] as const

function Users() {
  const { me } = appRoute.useRouteContext()
  const { users, teams, invites } = Route.useLoaderData()
  const [mode, setMode] = React.useState<'invite' | 'create'>('invite')
  const router = useRouter()
  const [error, setError] = React.useState<string | null>(null)
  const isLeader = me.role === 'TEAM_LEADER'

  async function act(fn: () => Promise<unknown>) {
    try {
      await fn()
      setError(null)
      router.invalidate()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro')
    }
  }

  function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const f = new FormData(form)
    act(() =>
      createUser({
        data: {
          name: String(f.get('name')),
          email: String(f.get('email')),
          password: String(f.get('password')),
          teamId: String(f.get('teamId')) || null,
          role: (isLeader ? 'MEMBER' : String(f.get('role'))) as (typeof ROLES)[number],
        },
      }).then(() => form.reset()),
    )
  }

  function onInvite(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const f = new FormData(form)
    act(() =>
      createInvitation({
        data: {
          email: String(f.get('email')),
          teamId: String(f.get('teamId')) || null,
          role: (isLeader ? 'MEMBER' : String(f.get('role'))) as (typeof ROLES)[number],
        },
      }).then(() => form.reset()),
    )
  }

  const teamAndRole = () => (
    <>
      <div className="space-y-1">
        <label htmlFor="teamId">Equipe</label>
        <select id="teamId" name="teamId" defaultValue={isLeader ? (me.teamId ?? '') : ''} disabled={isLeader}>
          {!isLeader && <option value="">Sem equipe</option>}
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      {!isLeader && (
        <div className="space-y-1">
          <label htmlFor="role">Papel</label>
          <select id="role" name="role" defaultValue="MEMBER">
            {ROLES.map((r) => <option key={r} value={r}>{roleLabel[r]}</option>)}
          </select>
        </div>
      )}
    </>
  )

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-neutral-400">Configurações</p>
        <h1 className="text-2xl font-bold tracking-tight">Usuários</h1>
      </div>
      <div className="flex gap-1 rounded-xl border border-neutral-800 p-1 text-xs font-medium">
        <button onClick={() => setMode('invite')} className={`flex-1 rounded-lg py-1.5 ${mode === 'invite' ? 'bg-neutral-800 text-neutral-50' : 'text-neutral-400'}`}><Mail className="mr-1 inline h-3.5 w-3.5" /> Convidar por email</button>
        <button onClick={() => setMode('create')} className={`flex-1 rounded-lg py-1.5 ${mode === 'create' ? 'bg-neutral-800 text-neutral-50' : 'text-neutral-400'}`}><UserPlus className="mr-1 inline h-3.5 w-3.5" /> Criar com senha</button>
      </div>
      {mode === 'invite' && (
        <form onSubmit={onInvite} className="card space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1"><label htmlFor="email">Email</label><input id="email" name="email" type="email" required /></div>
            {teamAndRole()}
          </div>
          <p className="text-xs text-neutral-500">A pessoa recebe um link válido por 7 dias e define a própria senha.</p>
          <button className="btn-primary"><Mail className="h-4 w-4" /> Enviar convite</button>
        </form>
      )}
      {mode === 'create' && (
      <form onSubmit={onCreate} className="card space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><label htmlFor="name">Nome</label><input id="name" name="name" required minLength={2} /></div>
          <div className="space-y-1"><label htmlFor="email">Email</label><input id="email" name="email" type="email" required /></div>
          <div className="space-y-1"><label htmlFor="password">Senha temporária</label><input id="password" name="password" type="text" required minLength={8} autoComplete="off" /></div>
          {teamAndRole()}
        </div>
        <p className="text-xs text-neutral-500">O usuário troca a senha no primeiro login.</p>
        <button className="btn-primary"><UserPlus className="h-4 w-4" /> Criar</button>
      </form>
      )}
      {error && <p className="text-sm text-rose-400">{error}</p>}
      {invites.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-neutral-300">Convites pendentes</h2>
          <ul className="divide-y divide-neutral-800 rounded-2xl border border-neutral-800">
            {invites.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-sm">{i.email}</div>
                  <div className="text-xs text-neutral-500">{roleLabel[i.role]}{i.teamName ? ` · ${i.teamName}` : ''} · expira {new Date(i.expiresAt).toLocaleDateString('pt-BR')}</div>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => act(() => resendInvitation({ data: { invitationId: i.id } }))} className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-900 hover:text-neutral-50" title="Reenviar"><RotateCw className="h-4 w-4" /></button>
                  <button onClick={() => act(() => cancelInvitation({ data: { invitationId: i.id } }))} className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-900 hover:text-rose-400" title="Cancelar"><X className="h-4 w-4" /></button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      <ul className="divide-y divide-neutral-800 rounded-2xl border border-neutral-800">
        {users.map((u) => (
          <li key={u.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <div className="truncate font-medium">{u.name}</div>
              <div className="truncate text-xs text-neutral-500">{u.email}</div>
            </div>
            {isLeader ? (
              <span className="text-xs text-neutral-400">{roleLabel[u.role]}</span>
            ) : (
              <div className="flex gap-2">
                <select
                  value={u.teamId ?? ''}
                  onChange={(e) => act(() => updateUser({ data: { userId: u.id, teamId: e.target.value || null, role: u.role as (typeof ROLES)[number] } }))}
                  className="w-auto py-1 text-xs"
                >
                  <option value="">Sem equipe</option>
                  {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <select
                  value={u.role}
                  onChange={(e) => act(() => updateUser({ data: { userId: u.id, teamId: u.teamId, role: e.target.value as (typeof ROLES)[number] } }))}
                  className="w-auto py-1 text-xs"
                >
                  {ROLES.map((r) => <option key={r} value={r}>{roleLabel[r]}</option>)}
                </select>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
