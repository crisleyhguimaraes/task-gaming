import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { KeyRound } from 'lucide-react'
import * as React from 'react'
import { authClient } from '#/lib/auth-client'
import { getAuthCtx } from '#/server/session.server'
import { clearMustChangePassword } from '#/server/users'

const requireLogin = createServerFn().handler(async () => {
  if (!(await getAuthCtx())) throw redirect({ to: '/login' })
})

export const Route = createFileRoute('/change-password')({
  beforeLoad: () => requireLogin(),
  component: ChangePassword,
})

function ChangePassword() {
  const router = useRouter()
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const newPassword = String(f.get('newPassword'))
    if (newPassword !== String(f.get('confirm'))) return setError('As senhas não conferem')
    setBusy(true)
    const res = await authClient.changePassword({ currentPassword: String(f.get('currentPassword')), newPassword })
    if (res.error) {
      setBusy(false)
      return setError(res.error.message ?? 'Senha atual incorreta')
    }
    await clearMustChangePassword()
    await router.invalidate()
    router.navigate({ to: '/' })
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-5">
      <div className="flex items-center gap-2 text-xp-400">
        <KeyRound className="h-6 w-6" />
        <span className="text-xl font-bold text-neutral-50">Defina sua senha</span>
      </div>
      <form onSubmit={onSubmit} className="card space-y-4">
        <div className="space-y-1"><label htmlFor="currentPassword">Senha atual (temporária)</label><input id="currentPassword" name="currentPassword" type="password" required autoComplete="current-password" /></div>
        <div className="space-y-1"><label htmlFor="newPassword">Nova senha</label><input id="newPassword" name="newPassword" type="password" required minLength={8} autoComplete="new-password" /></div>
        <div className="space-y-1"><label htmlFor="confirm">Confirmar</label><input id="confirm" name="confirm" type="password" required minLength={8} autoComplete="new-password" /></div>
        {error && <p className="text-sm text-rose-400">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>Salvar e entrar</button>
      </form>
    </main>
  )
}
