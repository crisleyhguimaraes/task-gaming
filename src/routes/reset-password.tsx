import { Link, createFileRoute } from '@tanstack/react-router'
import { KeyRound } from 'lucide-react'
import * as React from 'react'
import { authClient } from '#/lib/auth-client'

export const Route = createFileRoute('/reset-password')({
  validateSearch: (search: Record<string, unknown>) => ({ token: typeof search.token === 'string' ? search.token : undefined }),
  component: ResetPassword,
})

function ResetPassword() {
  const { token } = Route.useSearch()
  const [done, setDone] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const newPassword = String(f.get('newPassword'))
    if (newPassword !== String(f.get('confirm'))) return setError('As senhas não conferem')
    setBusy(true)
    setError(null)
    const res = await authClient.resetPassword({ newPassword, token })
    setBusy(false)
    if (res.error) return setError('Link inválido ou expirado. Peça um novo.')
    setDone(true)
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-5">
      <div className="flex items-center gap-2 text-xp-400">
        <KeyRound className="h-6 w-6" />
        <span className="text-xl font-bold text-neutral-50">Nova senha</span>
      </div>
      {done ? (
        <div className="card space-y-3 text-center">
          <p className="text-sm text-neutral-300">Senha alterada. Entre com a nova senha.</p>
          <Link to="/login" className="btn-primary">Ir para o login</Link>
        </div>
      ) : !token ? (
        <div className="card space-y-3 text-center">
          <p className="text-sm text-neutral-300">Este link é inválido ou expirou.</p>
          <Link to="/forgot-password" className="btn-ghost">Pedir um novo link</Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="card space-y-4">
          <div className="space-y-1"><label htmlFor="newPassword">Nova senha</label><input id="newPassword" name="newPassword" type="password" required minLength={8} autoComplete="new-password" /></div>
          <div className="space-y-1"><label htmlFor="confirm">Confirmar</label><input id="confirm" name="confirm" type="password" required minLength={8} autoComplete="new-password" /></div>
          {error && <p className="text-sm text-rose-400">{error}</p>}
          <button className="btn-primary w-full" disabled={busy}>{busy ? 'Salvando…' : 'Salvar senha'}</button>
        </form>
      )}
    </main>
  )
}
