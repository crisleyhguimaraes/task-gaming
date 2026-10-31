import { createFileRoute } from '@tanstack/react-router'
import * as React from 'react'
import { GeneralTab } from '#/components/goals/GeneralTab'
import { GoalsTab } from '#/components/goals/GoalsTab'
import { ScoringTab } from '#/components/goals/ScoringTab'
import { appRoute } from '#/lib/app-route'
import { listGoals } from '#/server/goals'
import { can } from '#/server/roles'
import { listScoringRules } from '#/server/scoring-rules'
import { getTenantSettings } from '#/server/tenant-settings'

export const Route = createFileRoute('/_app/settings/goals')({
  loader: async ({ context: { me } }) => {
    const [goals, scoringRules, general] = await Promise.all([
      can(me, 'goal.configure') ? listGoals() : [],
      can(me, 'scoring.configure') ? listScoringRules() : [],
      can(me, 'tenant.configure') ? getTenantSettings() : null,
    ])
    return { goals, scoringRules, general }
  },
  component: GoalsAndScoring,
})

type TabId = 'goals' | 'scoring' | 'general'

function GoalsAndScoring() {
  const { me } = appRoute.useRouteContext()
  const { goals, scoringRules, general } = Route.useLoaderData()
  const [selected, setSelected] = React.useState<TabId>('goals')

  const tabs = [
    { id: 'goals', label: 'Metas', allowed: can(me, 'goal.configure') },
    { id: 'scoring', label: 'Pontuações', allowed: can(me, 'scoring.configure') },
    { id: 'general', label: 'Geral', allowed: can(me, 'tenant.configure') },
  ] as const
  const allowedTabs = tabs.filter((tab) => tab.allowed)
  const active = allowedTabs.find((tab) => tab.id === selected)?.id ?? allowedTabs[0]?.id

  if (!active) return <p className="card text-sm text-neutral-400">Você não tem permissão para configurar metas e pontuação.</p>

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-neutral-400">Configurações</p>
        <h1 className="text-2xl font-bold tracking-tight">Metas e pontuação</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Equipe sem vínculo usa o padrão do tenant. Vincular uma equipe a uma meta ou pontuação substitui o padrão para ela, daqui para frente.
        </p>
      </div>
      <div className="flex gap-1 rounded-xl border border-neutral-800 p-1 text-xs font-medium">
        {allowedTabs.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            aria-pressed={id === active}
            onClick={() => setSelected(id)}
            className={`flex-1 rounded-lg py-1.5 ${id === active ? 'bg-neutral-800 text-neutral-50' : 'text-neutral-400'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {active === 'goals' && <GoalsTab goals={goals} />}
      {active === 'scoring' && <ScoringTab rules={scoringRules} />}
      {active === 'general' && general && <GeneralTab {...general} />}
    </div>
  )
}
