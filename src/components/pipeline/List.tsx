import { Link } from '@tanstack/react-router'
import { formatIsoDate } from '#/lib/format'
import { formatCents } from '#/lib/pipeline'
import { dealRows } from '#/lib/pipeline-list'
import { Avatar } from '../Avatar'
import type { StageColumn } from './Board'
import { DealStatusBadge } from './DealStatusBadge'

const KIND_DOT = { open: 'bg-brand-ring', won: 'bg-xp-400', lost: 'bg-rose-400' } as const

const HEADINGS = ['Negócio', 'Etapa', 'Valor', 'Previsão', 'Dono']

export function PipelineList({ columns }: { columns: Array<StageColumn> }) {
  const rows = dealRows(columns)
  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full min-w-[820px] text-sm">
        <thead className="border-b border-neutral-800 bg-neutral-950/60 text-left text-xs font-medium text-neutral-500">
          <tr>
            {HEADINGS.map((heading) => (
              <th key={heading} scope="col" className={`px-4 py-2.5 ${heading === 'Valor' ? 'text-right' : ''}`}>
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-800">
          {rows.map((deal) => (
            <tr key={deal.id} className="hover:bg-neutral-950/50">
              <td className="px-4 py-3">
                <Link to="/opportunities/$opportunityId" params={{ opportunityId: deal.id }} className="font-semibold hover:underline">
                  {deal.title}
                </Link>
                <div className="text-xs text-neutral-400">{deal.leadName}</div>
              </td>
              <td className="px-4 py-3">
                <span className="inline-flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${KIND_DOT[deal.stageKind]}`} />
                  {deal.stageName}
                </span>
              </td>
              <td className="px-4 py-3 text-right font-semibold tabular-nums">{formatCents(deal.amountCents)}</td>
              <td className="px-4 py-3">
                <span className="inline-flex items-center gap-2 tabular-nums">
                  {deal.expectedCloseDate ? formatIsoDate(deal.expectedCloseDate) : <span className="text-neutral-500">—</span>}
                  <DealStatusBadge expectedCloseDate={deal.expectedCloseDate} stageKind={deal.stageKind} />
                </span>
              </td>
              <td className="px-4 py-3">
                {deal.ownerName ? (
                  <span className="inline-flex items-center gap-2">
                    <Avatar name={deal.ownerName} size="sm" />
                    {deal.ownerName}
                  </span>
                ) : (
                  <span className="text-neutral-500 italic">Sem dono</span>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={HEADINGS.length} className="px-4 py-8 text-center text-neutral-500">
                Nenhum negócio com esses filtros.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
