import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { Shell } from '#/components/Shell'
import { getAuthCtx } from '#/server/session.server'
import { attentionCount, totalPoints } from '#/server/stats'
import { activeTaskFor } from '#/server/tasks.core'

const getMe = createServerFn().handler(async () => {
  const me = await getAuthCtx()
  if (!me) throw redirect({ to: '/login' })
  if (me.mustChangePassword) throw redirect({ to: '/change-password' })
  return { me, active: await activeTaskFor(me), totalPoints: await totalPoints(me.userId), attention: await attentionCount(me) }
})

export const Route = createFileRoute('/_app')({
  beforeLoad: () => getMe(),
  component: () => (
    <Shell>
      <Outlet />
    </Shell>
  ),
})
