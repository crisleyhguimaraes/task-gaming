import { useRouter } from '@tanstack/react-router'
import { Copy, ShieldCheck } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import * as React from 'react'
import { authClient } from '#/lib/auth-client'

const TOO_MANY_REQUESTS = 429
const QR_SIZE = 168

type Stage = { name: 'idle' } | { name: 'setup'; totpURI: string; backupCodes: Array<string> } | { name: 'codes'; backupCodes: Array<string> }

const failure = (status: number, fallback: string) => (status === TOO_MANY_REQUESTS ? 'Muitas tentativas. Aguarde um instante e tente de novo.' : fallback)
const secretOf = (totpURI: string) => new URL(totpURI).searchParams.get('secret') ?? ''

export function TwoFactorCard({ enabled, required }: { enabled: boolean; required: boolean }) {
  const router = useRouter()
  const [stage, setStage] = React.useState<Stage>({ name: 'idle' })
  const [error, setError] = React.useState<string | null>(null)

  async function start(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const res = await authClient.twoFactor.enable({ password: String(new FormData(e.currentTarget).get('password')) })
    if (res.error) return setError(failure(res.error.status, 'Senha incorreta.'))
    if (res.data.method !== 'totp') return setError('Não foi possível ativar o app autenticador.')
    setStage({ name: 'setup', totpURI: res.data.totpURI, backupCodes: res.data.backupCodes })
  }

  async function confirm(e: React.FormEvent<HTMLFormElement>, backupCodes: Array<string>) {
    e.preventDefault()
    setError(null)
    const res = await authClient.twoFactor.verifyTotp({ code: String(new FormData(e.currentTarget).get('code')).trim() })
    if (res.error) return setError(failure(res.error.status, 'Código inválido. Confira o horário do celular e tente de novo.'))
    setStage({ name: 'codes', backupCodes })
    await router.invalidate()
  }

  async function disable(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const res = await authClient.twoFactor.disable({ password: String(new FormData(e.currentTarget).get('password')) })
    if (res.error) return setError(failure(res.error.status, 'Senha incorreta.'))
    await router.invalidate()
  }

  return (
    <section className="card space-y-3">
      <h2 className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4" /> Verificação em duas etapas</h2>
      {required && !enabled && <p className="text-sm text-xp-400">Sua empresa exige a verificação em duas etapas. Ative para continuar usando o app.</p>}
      {stage.name === 'codes' ? (
        <RecoveryCodes codes={stage.backupCodes} onDone={() => setStage({ name: 'idle' })} />
      ) : stage.name === 'setup' ? (
        <form onSubmit={(e) => confirm(e, stage.backupCodes)} className="space-y-3">
          <p className="text-sm text-neutral-300">Leia o QR code no app autenticador (Google Authenticator, Authy, 1Password) e digite o código de 6 dígitos que ele mostrar.</p>
          <div className="inline-block rounded-lg bg-white p-3"><QRCodeSVG value={stage.totpURI} size={QR_SIZE} /></div>
          <p className="text-xs text-neutral-400">Sem câmera? Digite este segredo no app: <code className="select-all break-all text-neutral-200">{secretOf(stage.totpURI)}</code></p>
          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-1">
              <label htmlFor="totp-code">Código</label>
              <input id="totp-code" name="code" required inputMode="numeric" autoComplete="one-time-code" maxLength={6} />
            </div>
            <button className="btn-primary">Confirmar e ativar</button>
          </div>
        </form>
      ) : enabled ? (
        <>
          <p className="text-sm text-neutral-300">Ativada. Ao entrar, além da senha, você digita o código do app autenticador.</p>
          {!required && (
            <form onSubmit={disable} className="flex items-end gap-3">
              <div className="flex-1 space-y-1">
                <label htmlFor="disable-password">Senha</label>
                <input id="disable-password" name="password" type="password" required autoComplete="current-password" />
              </div>
              <button className="btn-ghost">Desativar</button>
            </form>
          )}
        </>
      ) : (
        <form onSubmit={start} className="flex items-end gap-3">
          <div className="flex-1 space-y-1">
            <label htmlFor="enable-password">Senha</label>
            <input id="enable-password" name="password" type="password" required autoComplete="current-password" />
          </div>
          <button className="btn-primary">Ativar</button>
        </form>
      )}
      {error && <p className="text-sm text-rose-300">{error}</p>}
    </section>
  )
}

function RecoveryCodes({ codes, onDone }: { codes: Array<string>; onDone: () => void }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-neutral-300">Ativada. Guarde estes códigos de recuperação num lugar seguro: cada um entra uma vez se você perder o celular. Eles não serão mostrados de novo.</p>
      <ul className="grid grid-cols-2 gap-1 font-mono text-sm">
        {codes.map((code) => <li key={code}>{code}</li>)}
      </ul>
      <div className="flex gap-3">
        <button type="button" className="btn-ghost" onClick={() => navigator.clipboard.writeText(codes.join('\n'))}><Copy className="h-4 w-4" /> Copiar</button>
        <button type="button" className="btn-primary" onClick={onDone}>Já guardei</button>
      </div>
    </div>
  )
}
