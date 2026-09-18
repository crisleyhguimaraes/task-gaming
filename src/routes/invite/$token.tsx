import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { Flame } from 'lucide-react'
import * as React from 'react'
import { authClient } from '#/lib/auth-client'
import { acceptInvitation, getInvitation } from '#/server/invitations'

export const Route = createFileRoute('/invite/$token')({
  loader: ({ params }) => getInvitation({ data: { token: params.token } }),
  component: Invite,
})

function Invite() {
  const inv = Route.useLoaderData()
  const { token } = Route.useParams()
  const router = useRouter()
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const password = String(f.get('password'))
    if (password !== String(f.get('confirm'))) return setError('As senhas não conferem')
    setBusy(true)
    try {
      const { email } = await acceptInvitation({ data: { token, name: String(f.get('name')), password } })
      const res = await authClient.signIn.email({ email, password })
      if (res.error) throw new Error(res.error.message ?? 'Erro ao entrar')
      await router.invalidate()
      router.navigate({ to: '/' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro')
      setBusy(false)
    }
  }

  const messages = { invalid: 'Convite inválido.', expired: 'Este convite expirou. Peça um novo ao seu gestor.', accepted: 'Este convite já foi usado.' }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-5">
      <div className="flex items-center gap-2 text-xp-400">
        <Flame className="h-7 w-7 fill-xp-400" />
        <span className="text-2xl font-black tracking-tight text-neutral-50">Task Gaming</span>
      </div>
      {inv.status !== 'valid' ? (
        <div className="card space-y-3 text-center">
          <p className="text-sm text-neutral-300">{messages[inv.status]}</p>
          <Link to="/login" className="btn-ghost">Ir para o login</Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="card space-y-4">
          <p className="text-sm text-neutral-300">
            Você foi convidado(a) para <b>{inv.tenantName}</b>{inv.teamName ? <> · equipe <b>{inv.teamName}</b></> : null}.
          </p>
          <div className="space-y-1"><label htmlFor="email">Email</label><input id="email" value={inv.email} readOnly className="opacity-60" /></div>
          <div className="space-y-1"><label htmlFor="name">Seu nome</label><input id="name" name="name" required minLength={2} autoComplete="name" /></div>
          <div className="space-y-1"><label htmlFor="password">Senha</label><input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" /></div>
          <div className="space-y-1"><label htmlFor="confirm">Confirmar senha</label><input id="confirm" name="confirm" type="password" required minLength={8} autoComplete="new-password" /></div>
          {error && <p className="text-sm text-rose-400">{error}</p>}
          <button className="btn-primary w-full" disabled={busy}>{busy ? 'Criando conta…' : 'Aceitar e entrar'}</button>
        </form>
      )}
    </main>
  )
}
