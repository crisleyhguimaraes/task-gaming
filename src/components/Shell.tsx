import { Link, useRouter, useRouterState } from '@tanstack/react-router'
import * as React from 'react'
import { Building2, ChevronDown, ClipboardList, Columns3, ContactRound, Flame, Funnel, Handshake, LayoutGrid, LogOut, Moon, ScrollText, Settings, ShieldCheck, SlidersHorizontal, Sun, SunMedium, Trophy, UserCircle, UserCog, Users, UsersRound } from 'lucide-react'
import { authClient } from '#/lib/auth-client'
import { appRoute } from '#/lib/app-route'
import { displayRole, fmtClock } from '#/lib/format'
import { useElapsed } from '#/lib/useElapsed'
import { getTheme, setTheme } from '#/lib/theme'
import type { Theme } from '#/lib/theme'
import { levelFor } from '#/server/levels'
import type { AuthCtx } from '#/server/roles'
import { can } from '#/server/roles'
import { Avatar } from './Avatar'
import { NotificationBell } from './NotificationBell'

export function Shell({ children }: { children: React.ReactNode }) {
  const { me, active, totalPoints, attention } = appRoute.useRouteContext()
  const router = useRouter()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  // grupos abertos: começa aberto se uma rota filha estiver ativa
  const [open, setOpen] = React.useState<Record<string, boolean>>({})
  const level = levelFor(totalPoints)

  async function signOut() {
    await authClient.signOut()
    await router.invalidate()
    router.navigate({ to: '/login' })
  }
  async function stopImpersonating() {
    await authClient.admin.stopImpersonating()
    await router.invalidate()
    router.navigate({ to: '/admin/tenants' })
  }

  type Path = '/' | '/challenges' | '/board' | '/team' | '/pipeline' | '/leads' | '/settings/teams' | '/settings/users' | '/settings/permissions' | '/settings/pipeline' | '/settings/boards' | '/settings/goals' | '/settings/audit' | '/admin/tenants'
  type Item = { to: Path; label: string; icon: typeof Sun; show: boolean; children?: Array<Item> }
  const settings: Array<Item> = [
    { to: '/settings/teams', label: 'Equipes', icon: UsersRound, show: can(me, 'team.manage') },
    { to: '/settings/users', label: 'Usuários', icon: UserCog, show: can(me, 'user.read') },
    { to: '/settings/permissions', label: 'Permissões', icon: ShieldCheck, show: can(me, 'permissions.manage') },
    { to: '/settings/pipeline', label: 'Pipelines', icon: Funnel, show: can(me, 'pipeline.configure') },
    { to: '/settings/boards', label: 'Boards', icon: LayoutGrid, show: can(me, 'board.manage') },
    { to: '/settings/goals', label: 'Metas e pontuação', icon: SlidersHorizontal, show: can(me, 'goal.configure') || can(me, 'scoring.configure') || can(me, 'tenant.configure') },
    { to: '/settings/audit', label: 'Auditoria', icon: ScrollText, show: can(me, 'audit.read') },
  ]
  const firstSetting = settings.find((c) => c.show)
  const nav: Array<Item> = [
    { to: '/', label: 'Hoje', icon: Sun, show: true },
    { to: '/challenges', label: 'Desafios', icon: Trophy, show: true },
    { to: '/board', label: 'Board', icon: Columns3, show: true },
    { to: '/pipeline', label: 'Pipeline', icon: Handshake, show: true },
    { to: '/leads', label: 'Leads', icon: ContactRound, show: true },
    { to: '/team', label: 'Equipe', icon: Users, show: true },
    {
      // Configurações: o pai leva ao primeiro subitem; subitens sempre visíveis, indentados.
      to: firstSetting?.to ?? '/settings/users',
      label: 'Configurações',
      icon: Settings,
      show: Boolean(firstSetting),
      children: settings,
    },
    { to: '/admin/tenants', label: 'Tenants', icon: Building2, show: me.role === 'SUPER_ADMIN' },
  ]
  const isOpen = (n: Item) => open[n.label] ?? (n.children?.some((c) => pathname.startsWith(c.to)) ?? false)
  const linkCls = 'flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-neutral-400 hover:bg-neutral-900 hover:text-neutral-50 [&.active]:bg-neutral-900 [&.active]:font-semibold [&.active]:text-neutral-50'

  return (
    <div className="min-h-screen lg:flex">
      <aside className="flex flex-col gap-4 border-b border-neutral-900 bg-neutral-950 px-4 py-4 lg:sticky lg:top-0 lg:h-screen lg:w-60 lg:shrink-0 lg:border-r lg:border-b-0 lg:px-5 lg:py-6">
        <Link to="/" className="flex items-center gap-2">
          <span className="tile-green h-8 w-8 rounded-lg"><Flame className="h-4 w-4 fill-current" /></span>
          <span className="text-lg font-bold tracking-tight">Task Gaming</span>
        </Link>

        <div className="hidden flex-col items-center gap-2 pt-4 text-center lg:flex">
          <Avatar name={me.name} size="xl" />
          <div>
            <div className="font-semibold">{me.name}</div>
            <div className="text-xs text-neutral-400">{displayRole(me)}</div>
          </div>
          <div className="w-full space-y-1.5 pt-2">
            <div className="flex justify-between text-xs">
              <span className="font-semibold text-neutral-200">
                {level.next ? `${totalPoints - level.min}/${level.next - level.min} pts` : `${totalPoints} pts`}
              </span>
              <span className="text-neutral-400">Nível {level.level}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-800">
              <div className="h-full rounded-full bg-gradient-to-r from-xp-600 to-xp-400" style={{ width: `${level.pct}%` }} />
            </div>
            <div className="text-xs text-neutral-500">{level.name}{level.next ? ` · faltam ${level.toNext} pts` : ' · nível máximo'}</div>
          </div>
        </div>

        <nav className="-mx-4 flex gap-1 overflow-x-auto px-4 lg:mx-0 lg:mt-2 lg:flex-col lg:overflow-visible lg:px-0">
          {nav.filter((n) => n.show).map((n) => (
            <React.Fragment key={n.label}>
              {n.children ? (
                // desktop: botão que abre/fecha o grupo; mobile (nav horizontal): pai some, subitens aparecem
                <button
                  type="button"
                  onClick={() => setOpen((o) => ({ ...o, [n.label]: !isOpen(n) }))}
                  aria-expanded={isOpen(n)}
                  className={`${linkCls} hidden w-full lg:flex ${n.children.some((c) => pathname.startsWith(c.to)) ? 'text-neutral-50' : ''}`}
                >
                  <n.icon className="h-4 w-4" />
                  {n.label}
                  <ChevronDown className={`ml-auto h-4 w-4 transition-transform ${isOpen(n) ? 'rotate-180' : ''}`} />
                </button>
              ) : (
                <Link to={n.to} activeOptions={{ exact: n.to === '/' }} className={linkCls}>
                  <n.icon className="h-4 w-4" />
                  {n.label}
                </Link>
              )}
              {n.children?.filter((c) => c.show).map((c) => (
                <Link key={c.to} to={c.to} className={`${linkCls} lg:ml-4 lg:py-1.5 lg:text-[13px] ${isOpen(n) ? '' : 'lg:hidden'}`}>
                  <c.icon className="h-4 w-4" />
                  {c.label}
                </Link>
              ))}
            </React.Fragment>
          ))}
        </nav>

      </aside>

      <div className="min-w-0 flex-1">
        <main className="mx-auto max-w-[1180px] px-4 py-4 pb-28 lg:px-8">
          <HeaderActions me={me} attention={attention} onSignOut={signOut} />
          {me.impersonatedBy && (
            <div className="mb-4 flex items-center justify-between rounded-xl border border-amber-800/60 bg-amber-950/40 px-3 py-2 text-xs text-amber-300">
              <span>Você está como <b>{me.name}</b></span>
              <button onClick={stopImpersonating} className="font-semibold underline">Voltar</button>
            </div>
          )}
          {children}
        </main>
      </div>
      {active && <Hud task={active} />}
    </div>
  )
}

const roundBtn = 'relative flex h-11 w-11 items-center justify-center rounded-full border border-neutral-800 bg-neutral-900 text-neutral-300 shadow-sm hover:text-neutral-50'

/** Topo à direita: tema, sino de atenção e avatar com o menu do usuário. */
function HeaderActions({ me, attention, onSignOut }: { me: Pick<AuthCtx, 'name' | 'role' | 'memberships'>; attention: { pool: number; validation: number }; onSignOut: () => void }) {
  const [theme, setThemeState] = React.useState<Theme>('dark')
  React.useEffect(() => setThemeState(getTheme()), [])
  const choose = (t: Theme) => {
    setTheme(t)
    setThemeState(t)
  }
  const alerts = attention.pool + attention.validation
  const alertText = [
    attention.pool > 0 ? `${attention.pool} no pool da equipe` : null,
    attention.validation > 0 ? `${attention.validation} aguardando validação` : null,
  ].filter(Boolean).join(' · ')

  return (
    <div className="mb-4 flex items-center justify-end gap-2">
      <button type="button" onClick={() => choose(theme === 'dark' ? 'light' : 'dark')} className={roundBtn} title={theme === 'dark' ? 'Mudar para claro' : 'Mudar para escuro'}>
        {theme === 'dark' ? <SunMedium className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
      </button>
      <NotificationBell />
      <Link to="/team" className={roundBtn} title={alertText || 'Nada pendente'}>
        <ClipboardList className="h-5 w-5" />
        {alerts > 0 && <span className="absolute top-2 right-2.5 h-2.5 w-2.5 rounded-full border-2 border-neutral-900 bg-rose-500" />}
      </Link>
      <details className="relative">
        <summary className="flex cursor-pointer list-none [&::-webkit-details-marker]:hidden">
          <span className="relative">
            <Avatar name={me.name} size="lg" />
            <span className="absolute right-0 bottom-0 h-3 w-3 rounded-full border-2 border-neutral-950 bg-xp-400" title="Online" />
          </span>
        </summary>
        <div className="absolute top-full right-0 z-30 mt-2 w-64 rounded-2xl border border-neutral-800 bg-neutral-900 p-2 shadow-2xl shadow-black/30">
          <div className="flex items-center gap-3 px-2 py-2">
            <Avatar name={me.name} />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{me.name}</div>
              <div className="truncate text-xs text-neutral-400">{displayRole(me)}</div>
            </div>
          </div>
          <div className="my-1 border-t border-neutral-800" />
          <Link to="/profile" className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-800 hover:text-neutral-50" onClick={(e) => e.currentTarget.closest('details')?.removeAttribute('open')}>
            <UserCircle className="h-4 w-4" /> Meu perfil
          </Link>
          <div className="px-3 py-2">
            <div className="mb-1.5 text-xs text-neutral-400">Tema</div>
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-neutral-950/60 p-1 text-xs font-medium">
              <button type="button" onClick={() => choose('dark')} className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 ${theme === 'dark' ? 'bg-neutral-800 text-neutral-50' : 'text-neutral-400'}`}>
                <Moon className="h-3.5 w-3.5" /> Escuro
              </button>
              <button type="button" onClick={() => choose('light')} className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 ${theme === 'light' ? 'bg-neutral-800 text-neutral-50' : 'text-neutral-400'}`}>
                <SunMedium className="h-3.5 w-3.5" /> Claro
              </button>
            </div>
          </div>
          <div className="my-1 border-t border-neutral-800" />
          <button onClick={onSignOut} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-800 hover:text-neutral-50">
            <LogOut className="h-4 w-4" /> Sair
          </button>
        </div>
      </details>
    </div>
  )
}

/** Barra fixa com a tarefa em andamento, visível em qualquer tela. */
function Hud({ task }: { task: NonNullable<ReturnType<typeof appRoute.useRouteContext>['active']> }) {
  const { seconds } = useElapsed(task.accumulatedSeconds, task.activeStartedAt, task.cap)
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const running = task.status === 'in_progress'
  if (pathname === `/tasks/${task.id}`) return null
  return (
    <Link
      to="/tasks/$taskId"
      params={{ taskId: task.id }}
      className="fixed right-4 bottom-4 left-4 z-40 flex items-center justify-between rounded-2xl border border-xp-500/30 bg-neutral-900/95 px-4 py-3 shadow-2xl shadow-black/40 backdrop-blur lg:left-[calc(15rem+1rem)]"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-xp-400">
          {running && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-xp-400" />}
          {running ? 'Em andamento' : 'Pausada'}
        </div>
        <div className="truncate text-sm font-medium">{task.title}</div>
      </div>
      <div className="text-xl font-bold tabular-nums">{fmtClock(seconds)}</div>
    </Link>
  )
}
