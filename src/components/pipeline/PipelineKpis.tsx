import { Briefcase, Coins, Hourglass, Target, Trophy } from 'lucide-react'
import { formatCents, formatRate } from '#/lib/pipeline'
import { pipelineKpis } from '#/lib/pipeline-kpis'
import { KpiCard } from '../KpiCard'
import type { StageColumn } from './Board'

const formatDays = (days: number | null) => (days === null ? '—' : `${Math.round(days)} dias`)

export function PipelineKpis({ columns, funnel, periodDays }: { columns: Array<StageColumn>; funnel: { winRate: number | null; averageCycleDays: number | null }; periodDays: number }) {
  const kpis = pipelineKpis(columns, funnel)
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <KpiCard icon={Coins} label="Pipeline aberto" value={formatCents(kpis.openCents)} />
      <KpiCard icon={Target} label="Forecast ponderado" value={formatCents(kpis.forecastCents)} />
      <KpiCard icon={Briefcase} label="Negócios abertos" value={String(kpis.openCount)} />
      <KpiCard icon={Trophy} label="Taxa de ganho" value={formatRate(kpis.winRate)} hint={`Últimos ${periodDays} dias`} />
      <KpiCard icon={Hourglass} label="Ciclo médio das ganhas" value={formatDays(kpis.averageCycleDays)} />
    </div>
  )
}
