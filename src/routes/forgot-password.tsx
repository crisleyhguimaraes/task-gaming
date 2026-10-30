import { Link, createFileRoute } from '@tanstack/react-router'
import { KeyRound } from 'lucide-react'
import * as React from 'react'
import { authClient } from '#/lib/auth-client'

export const Route = createFileRoute('/forgot-password')({ component: ForgotPassword })

const TOO_MANY_REQUESTS = 429

function ForgotPassword() {
  const [sent, setSent] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const email = String(new FormData(e.currentTarget).get('email'))
    const res = await authClient.requestPasswordReset({ email, redirectTo: '/reset-password' })
    setBusy(false)
    if (res.error) return setError(res.error.status === TOO_MANY_REQUESTS ? 'Muitos pedidos seguidos. Tente de novo em alguns minutos.' : 'Não foi possível enviar agora. Tente de novo.')
    setSent(true)
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-5">
      <div className="flex items-center gap-2 text-xp-400">
        <KeyRound className="h-6 w-6" />
        <span className="text-xl font-bold text-neutral-50">Esqueci minha senha</span>
      </div>
      {sent ? (
        <div className="card space-y-3 text-center">
          <p className="text-sm text-neutral-300">Se esse email tiver conta, enviamos um link para escolher uma nova senha. Ele vale por 1 hora.</p>
          <Link to="/login" className="btn-ghost">Voltar ao login</Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="card space-y-4">
          <p className="text-sm text-neutral-400">Informe o email da sua conta e enviaremos um link para redefinir a senha.</p>
          <div className="space-y-1">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" autoComplete="email" required />
          </div>
          {error && <p className="text-sm text-rose-400">{error}</p>}
          <button className="btn-primary w-full" disabled={busy}>{busy ? 'Enviando…' : 'Enviar link'}</button>
          <Link to="/login" className="block text-center text-sm text-neutral-400 hover:text-neutral-200">Voltar ao login</Link>
        </form>
      )}
    </main>
  )
}
