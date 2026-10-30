import { Link, createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { ShieldCheck } from 'lucide-react'
import * as React from 'react'
import { authClient } from '#/lib/auth-client'
import { getAuthCtx } from '#/server/session.server'

const redirectIfLogged = createServerFn().handler(async () => {
  if (await getAuthCtx()) throw redirect({ to: '/' })
})

export const Route = createFileRoute('/two-factor')({
  beforeLoad: () => redirectIfLogged(),
  component: TwoFactor,
})

const TOO_MANY_REQUESTS = 429

function failureMessage(error: { status: number; code?: string }) {
  if (error.status === TOO_MANY_REQUESTS) return 'Muitas tentativas. Aguarde um instante e tente de novo.'
  if (error.code === 'INVALID_TWO_FACTOR_COOKIE') return 'A verificação expirou. Entre de novo com sua senha.'
  return 'Código inválido.'
}

function TwoFactor() {
  const router = useRouter()
  const [useRecovery, setUseRecovery] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const code = String(new FormData(e.currentTarget).get('code')).trim()
    const res = useRecovery ? await authClient.twoFactor.verifyBackupCode({ code }) : await authClient.twoFactor.verifyTotp({ code })
    if (res.error) {
      setBusy(false)
      return setError(failureMessage(res.error))
    }
    await router.invalidate()
    router.navigate({ to: '/' })
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-5">
      <div className="flex items-center gap-2 text-xp-400">
        <ShieldCheck className="h-6 w-6" />
        <span className="text-xl font-bold text-neutral-50">Verificação em duas etapas</span>
      </div>
      <form onSubmit={onSubmit} className="card space-y-4">
        <p className="text-sm text-neutral-400">
          {useRecovery ? 'Digite um dos códigos de recuperação que você guardou. Cada um vale uma vez.' : 'Digite o código de 6 dígitos do seu app autenticador.'}
        </p>
        <div className="space-y-1">
          <label htmlFor="code">{useRecovery ? 'Código de recuperação' : 'Código'}</label>
          <input
            key={String(useRecovery)}
            id="code"
            name="code"
            required
            autoFocus
            autoComplete="one-time-code"
            inputMode={useRecovery ? 'text' : 'numeric'}
            maxLength={useRecovery ? 11 : 6}
          />
        </div>
        {error && <p className="text-sm text-rose-400">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Verificando…' : 'Verificar'}</button>
        <button type="button" onClick={() => setUseRecovery((v) => !v)} className="block w-full text-center text-sm text-neutral-400 hover:text-neutral-200">
          {useRecovery ? 'Usar o app autenticador' : 'Usar um código de recuperação'}
        </button>
        <Link to="/login" className="block text-center text-sm text-neutral-400 hover:text-neutral-200">Voltar ao login</Link>
      </form>
    </main>
  )
}
