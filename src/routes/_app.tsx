import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { Shell } from '#/components/Shell'
import { getAuthCtx } from '#/server/session.server'
import { attentionCount, totalPoints } from '#/server/stats'
import { activeTaskFor } from '#/server/tasks.core'
import { twoFactorStatusFor } from '#/server/two-factor.core'

const getMe = createServerFn().handler(async () => {
  const me = await getAuthCtx()
  if (!me) throw redirect({ to: '/login' })
  if (me.mustChangePassword) throw redirect({ to: '/change-password' })
  const { setupPending } = await twoFactorStatusFor(me)
  return { me, active: await activeTaskFor(me), totalPoints: await totalPoints(me.userId), attention: await attentionCount(me), twoFactorSetupPending: setupPending }
})

export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ location }) => {
    const ctx = await getMe()
    if (ctx.twoFactorSetupPending && location.pathname !== '/profile') throw redirect({ to: '/profile' })
    return ctx
  },
  component: () => (
    <Shell>
      <Outlet />
    </Shell>
  ),
})
