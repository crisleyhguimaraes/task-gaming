import { Coins, Hourglass, Target, Trophy } from 'lucide-react'
import * as React from 'react'
import { formatCents, formatRate } from '#/lib/pipeline'
import type { getFunnel } from '#/server/pipeline'
import { StatTile } from '../StatTile'
import type { StageColumn } from './Board'

type Funnel = Awaited<ReturnType<typeof getFunnel>>

const W = 560
const ROW_H = 34
const BAR_H = 14
const LABEL_W = 120
const VALUE_W = 120
const BAR_MAX_W = W - LABEL_W - VALUE_W

const formatDays = (days: number | null) => (days === null ? '—' : `${Math.round(days)} dias`)

export function FunnelPanel({ funnel, columns, periodDays }: { funnel: Funnel; columns: Array<StageColumn>; periodDays: number }) {
  const open = columns.filter((c) => c.kind === 'open')
  const openAmount = open.reduce((sum, c) => sum + c.amountCents, 0)
  const forecast = open.reduce((sum, c) => sum + c.weightedCents, 0)
  return (
    <section className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile icon={Target} tone="green" label="Forecast ponderado" value={formatCents(forecast)} />
        <StatTile icon={Coins} tone="cyan" label="Pipeline aberto" value={formatCents(openAmount)} />
        <StatTile icon={Trophy} tone="gold" label={`Taxa de ganho (${periodDays}d)`} value={formatRate(funnel.winRate)} />
        <StatTile icon={Hourglass} tone="violet" label="Ciclo médio das ganhas" value={formatDays(funnel.averageCycleDays)} />
      </div>
      <div className="card space-y-2">
        <h2 className="text-sm font-semibold text-neutral-300">
          Conversão entre etapas <span className="font-normal text-neutral-500">· {funnel.created} criadas nos últimos {periodDays} dias · {funnel.won} ganhas, {funnel.lost} perdidas</span>
        </h2>
        {funnel.created === 0 ? <p className="py-4 text-sm text-neutral-500">Nenhuma oportunidade criada no período.</p> : <ConversionBars steps={funnel.conversion} />}
      </div>
    </section>
  )
}

function ConversionBars({ steps }: { steps: Funnel['conversion'] }) {
  const [hover, setHover] = React.useState<number | null>(null)
  const widest = Math.max(1, ...steps.map((s) => s.reached))
  const height = steps.length * ROW_H
  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img" aria-label="Oportunidades que alcançaram cada etapa aberta" onMouseLeave={() => setHover(null)}>
      {steps.map((step, i) => {
        const y = i * ROW_H
        const width = Math.max(2, (step.reached / widest) * BAR_MAX_W)
        return (
          <g key={step.stageId} onMouseEnter={() => setHover(i)}>
            <title>{`${step.name}: ${step.reached} oportunidades${step.rateFromPrevious === null ? '' : ` (${formatRate(step.rateFromPrevious)} da etapa anterior)`}`}</title>
            <rect x={0} y={y} width={W} height={ROW_H} fill={hover === i ? 'var(--color-neutral-800)' : 'transparent'} opacity={0.5} rx={6} />
            <text x={8} y={y + ROW_H / 2 + 4} fontSize="12" fill="var(--color-neutral-300)">{step.name}</text>
            <rect x={LABEL_W} y={y + (ROW_H - BAR_H) / 2} width={width} height={BAR_H} rx={4} fill="var(--color-xp-600)" />
            <text x={W - 8} y={y + ROW_H / 2 + 4} textAnchor="end" fontSize="12" fill="var(--color-neutral-300)">
              {step.reached}
              <tspan fill="var(--color-neutral-500)">{step.rateFromPrevious === null ? '' : ` · ${formatRate(step.rateFromPrevious)}`}</tspan>
            </text>
          </g>
        )
      })}
    </svg>
  )
}
