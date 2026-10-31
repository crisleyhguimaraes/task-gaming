import { createFileRoute, useRouter } from '@tanstack/react-router'
import { CalendarDays, CheckCircle2, Flame, KeyRound, LogOut, Medal } from 'lucide-react'
import * as React from 'react'
import { Avatar } from '#/components/Avatar'
import { Ring } from '#/components/Ring'
import { StatTile } from '#/components/StatTile'
import { TwoFactorCard } from '#/components/TwoFactorCard'
import { appRoute } from '#/lib/app-route'
import { authClient } from '#/lib/auth-client'
import { displayRole } from '#/lib/format'
import { levelFor } from '#/server/levels'
import { getProfile, updateProfile } from '#/server/profile'
import { getTwoFactorStatus } from '#/server/two-factor'

export const Route = createFileRoute('/_app/profile')({
  staticData: { pageWidth: 'narrow' },
  loader: async () => {
    const [profile, twoFactor] = await Promise.all([getProfile(), getTwoFactorStatus()])
    return { profile, twoFactor }
  },
  component: Profile,
})

function Profile() {
  const { me } = appRoute.useRouteContext()
  const { profile: p, twoFactor } = Route.useLoaderData()
  const router = useRouter()
  const level = levelFor(p.totalPoints)
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null)

  async function saveName(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    try {
      await updateProfile({ data: { name: String(new FormData(e.currentTarget).get('name')) } })
      await router.invalidate()
      setMsg({ ok: true, text: 'Nome atualizado.' })
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : 'Não foi possível salvar.' })
    }
  }

  async function savePassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const f = new FormData(form)
    const newPassword = String(f.get('newPassword'))
    if (newPassword !== String(f.get('confirm'))) return setMsg({ ok: false, text: 'As senhas não conferem.' })
    const res = await authClient.changePassword({ currentPassword: String(f.get('currentPassword')), newPassword })
    if (res.error) return setMsg({ ok: false, text: 'Senha atual incorreta.' })
    form.reset()
    setMsg({ ok: true, text: 'Senha alterada.' })
  }

  async function signOut() {
    await authClient.signOut()
    await router.invalidate()
    router.navigate({ to: '/login' })
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <h1 className="text-2xl font-bold tracking-tight">Meu perfil</h1>

      <section className="card flex flex-wrap items-center gap-5 p-5">
        <Ring pct={level.pct} size={112} stroke={9}>
          <Avatar name={p.name} size="xl" />
        </Ring>
        <div className="min-w-0 flex-1">
          <div className="text-xl font-bold">{p.name}</div>
          <div className="text-sm text-neutral-400">{p.email}</div>
          <div className="mt-1 text-sm text-neutral-300">
            {displayRole(me)}{p.teams.length > 0 ? ` · ${p.teams.map((t) => t.name).join(', ')}` : ''}
          </div>
          <div className="mt-2 text-sm">
            <span className="font-semibold text-xp-400">Nível {level.level} · {level.name}</span>
            <span className="text-neutral-400">{level.next ? ` · faltam ${level.toNext} pts` : ' · nível máximo'}</span>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile icon={Medal} tone="violet" value={p.totalPoints} label="Pontos" />
        <StatTile icon={CheckCircle2} tone="green" value={p.finished} label="Concluídas" />
        <StatTile icon={Flame} tone="gold" value={p.streak} label="Dias seguidos" />
        <StatTile icon={CalendarDays} tone="cyan" value={new Date(p.memberSince).toLocaleDateString('pt-BR', { month: '2-digit', year: '2-digit' })} label="Na empresa desde" />
      </div>

      {msg && <p className={`text-sm ${msg.ok ? 'text-xp-400' : 'text-rose-300'}`}>{msg.text}</p>}

      <form onSubmit={saveName} className="card space-y-3">
        <h2 className="font-semibold">Dados</h2>
        <div className="flex items-end gap-3">
          <div className="flex-1 space-y-1">
            <label htmlFor="name">Nome</label>
            <input id="name" name="name" defaultValue={p.name} required minLength={2} maxLength={120} />
          </div>
          <button className="btn-primary">Salvar</button>
        </div>
        <p className="text-xs text-neutral-500">Email e equipe são definidos pelo gestor.</p>
      </form>

      <form onSubmit={savePassword} className="card space-y-3">
        <h2 className="flex items-center gap-2 font-semibold"><KeyRound className="h-4 w-4" /> Senha</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1"><label htmlFor="currentPassword">Atual</label><input id="currentPassword" name="currentPassword" type="password" required autoComplete="current-password" /></div>
          <div className="space-y-1"><label htmlFor="newPassword">Nova</label><input id="newPassword" name="newPassword" type="password" required minLength={8} autoComplete="new-password" /></div>
          <div className="space-y-1"><label htmlFor="confirm">Confirmar</label><input id="confirm" name="confirm" type="password" required minLength={8} autoComplete="new-password" /></div>
        </div>
        <button className="btn-ghost">Alterar senha</button>
      </form>

      <TwoFactorCard enabled={twoFactor.enabled} required={twoFactor.required} />

      <button onClick={signOut} className="btn-ghost w-full text-neutral-300">
        <LogOut className="h-4 w-4" /> Sair da conta
      </button>
    </div>
  )
}
