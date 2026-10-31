import { UserPlus } from 'lucide-react'
import type { FormEvent } from 'react'
import type { AuthCtx } from '#/server/roles'
import { createUser } from '#/server/users'
import type { Act, Team } from './model'
import { readPlacement } from './model'
import { PlacementFields } from './PlacementFields'

export function CreateUserForm({ me, teams, act }: { me: AuthCtx; teams: ReadonlyArray<Team>; act: Act }) {
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const f = new FormData(form)
    act(() =>
      createUser({ data: { name: String(f.get('name')), email: String(f.get('email')), password: String(f.get('password')), ...readPlacement(f) } }).then(() => form.reset()),
    )
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1"><label htmlFor="name">Nome</label><input id="name" name="name" required minLength={2} /></div>
        <div className="space-y-1"><label htmlFor="email">E-mail</label><input id="email" name="email" type="email" required /></div>
        <div className="space-y-1"><label htmlFor="password">Senha temporária</label><input id="password" name="password" type="text" required minLength={8} autoComplete="off" /></div>
        <PlacementFields me={me} teams={teams} capability="user.create" />
      </div>
      <p className="text-xs text-neutral-500">A pessoa troca a senha no primeiro login.</p>
      <button className="btn-primary"><UserPlus className="h-4 w-4" /> Criar usuário</button>
    </form>
  )
}
