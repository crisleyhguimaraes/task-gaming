import { Link, useMatches, useRouter, useRouterState } from '@tanstack/react-router'
import type * as React from 'react'
import { authClient } from '#/lib/auth-client'
import { appRoute } from '#/lib/app-route'
import { fmtClock } from '#/lib/format'
import { buildNav } from '#/lib/navigation'
import { DEFAULT_PAGE_WIDTH } from '#/lib/page-width'
import { useElapsed } from '#/lib/useElapsed'
import { PageContainer } from './PageContainer'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'

export function Shell({ children }: { children: React.ReactNode }) {
  const { me, active, totalPoints, attention } = appRoute.useRouteContext()
  const router = useRouter()
  const width = useMatches({ select: (matches) => [...matches].reverse().find((m) => m.staticData.pageWidth)?.staticData.pageWidth ?? DEFAULT_PAGE_WIDTH })

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

  return (
    <div className="min-h-screen lg:flex">
      <Sidebar sections={buildNav(me)} me={me} totalPoints={totalPoints} />
      <div className="min-w-0 flex-1">
        <Topbar me={me} attention={attention} onSignOut={signOut} />
        <main className="px-4 py-6 pb-28 lg:px-8">
          {me.impersonatedBy && (
            <div className="mb-4 flex items-center justify-between rounded-xl border border-amber-800/60 bg-amber-950/40 px-3 py-2 text-xs text-amber-300">
              <span>
                Você está como <b>{me.name}</b>
              </span>
              <button onClick={stopImpersonating} className="font-semibold underline">
                Voltar
              </button>
            </div>
          )}
          <PageContainer width={width}>{children}</PageContainer>
        </main>
      </div>
      {active && <Hud task={active} />}
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
      className="fixed right-4 bottom-4 left-4 z-40 flex items-center justify-between rounded-2xl border border-xp-500/30 bg-neutral-900/95 px-4 py-3 shadow-2xl shadow-black/40 backdrop-blur lg:left-[calc(248px+1rem)]"
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
