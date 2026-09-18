import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { Flame } from 'lucide-react'
import * as React from 'react'
import { Ring } from '#/components/Ring'
import { authClient } from '#/lib/auth-client'
import { getAuthCtx } from '#/server/session.server'

const redirectIfLogged = createServerFn().handler(async () => {
  if (await getAuthCtx()) throw redirect({ to: '/' })
})

export const Route = createFileRoute('/login')({
  beforeLoad: () => redirectIfLogged(),
  component: Login,
})

function Login() {
  const router = useRouter()
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const f = new FormData(e.currentTarget)
    const res = await authClient.signIn.email({ email: String(f.get('email')), password: String(f.get('password')) })
    setBusy(false)
    if (res.error) return setError('Email ou senha não conferem.')
    await router.invalidate()
    router.navigate({ to: '/' })
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-8 px-5">
      <div className="flex flex-col items-center gap-3 text-center">
        <Ring pct={72} size={88} stroke={8}>
          <Flame className="h-8 w-8 fill-xp-400 text-xp-400" />
        </Ring>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Task Gaming</h1>
          <p className="text-sm text-neutral-400">Seu dia de trabalho, com placar.</p>
        </div>
      </div>
      <form onSubmit={onSubmit} className="card space-y-4 p-5">
        <div className="space-y-1">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div className="space-y-1">
          <label htmlFor="password">Senha</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        {error && <p className="text-sm text-rose-300">{error}</p>}
        <button className="btn-primary w-full py-3" disabled={busy}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </main>
  )
}
