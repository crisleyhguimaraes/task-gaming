import { Link } from '@tanstack/react-router'
import type { BoardTask } from './kanban/Board'

const DAY = 86_400_000
const ROW = 34
const LABEL_W = 180
const DAY_W = 28
const STATUS_FILL: Record<BoardTask['status'], string> = {
  pending: 'fill-neutral-600', in_progress: 'fill-xp-400', paused: 'fill-xp-800', finished: 'fill-emerald-500', cancelled: 'fill-neutral-800',
}
const parse = (d: string) => new Date(`${d}T00:00:00Z`).getTime()

/** Gantt mínimo em SVG: linha por tarefa com datas, coluna por dia, setas entre dependências. */
export function Timeline({ tasks, edges }: { tasks: Array<BoardTask>; edges: Array<{ taskId: string; dependsOnTaskId: string }> }) {
  const scheduled = tasks.filter((t) => t.scheduledStart && t.scheduledEnd).sort((a, b) => a.scheduledStart!.localeCompare(b.scheduledStart!))
  const rest = tasks.filter((t) => !scheduled.includes(t))
  if (scheduled.length === 0) {
    return <p className="card text-sm text-neutral-500">Nenhuma tarefa com datas de cronograma. Defina início/fim em "Editar".</p>
  }
  const min = Math.min(...scheduled.map((t) => parse(t.scheduledStart!)))
  const max = Math.max(...scheduled.map((t) => parse(t.scheduledEnd!)))
  const days = Math.round((max - min) / DAY) + 1
  const x = (d: string) => LABEL_W + ((parse(d) - min) / DAY) * DAY_W
  const rowY = new Map(scheduled.map((t, i) => [t.id, 30 + i * ROW]))
  const width = LABEL_W + days * DAY_W
  const height = 30 + scheduled.length * ROW + 10
  const todayX = LABEL_W + ((Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()) - min) / DAY) * DAY_W

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-2xl border border-neutral-800 bg-neutral-950/60">
        <svg width={width} height={height} className="block text-neutral-100">
          {Array.from({ length: days }, (_, i) => {
            const d = new Date(min + i * DAY)
            const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6
            return (
              <g key={i}>
                <rect x={LABEL_W + i * DAY_W} y={0} width={DAY_W} height={height} className={weekend ? 'fill-neutral-900/60' : 'fill-transparent'} />
                <text x={LABEL_W + i * DAY_W + DAY_W / 2} y={16} textAnchor="middle" fontSize="10" className="fill-neutral-500">
                  {d.getUTCDate()}
                </text>
              </g>
            )
          })}
          {todayX >= LABEL_W && todayX <= width && <line x1={todayX} x2={todayX} y1={22} y2={height} className="stroke-xp-500/60" strokeDasharray="3 3" />}
          {edges.map((e) => {
            const from = scheduled.find((t) => t.id === e.dependsOnTaskId)
            const to = scheduled.find((t) => t.id === e.taskId)
            if (!from || !to) return null
            const x1 = x(from.scheduledEnd!) + DAY_W
            const y1 = rowY.get(from.id)! + 10
            const x2 = x(to.scheduledStart!)
            const y2 = rowY.get(to.id)! + 10
            const mid = Math.max(x1 + 10, x2 - 10)
            return <path key={`${e.taskId}-${e.dependsOnTaskId}`} d={`M${x1},${y1} C${mid},${y1} ${x2 - 10},${y2} ${x2},${y2}`} fill="none" className="stroke-rose-400/70" strokeWidth="1.5" markerEnd="url(#arrow)" />
          })}
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" className="fill-rose-400/70" />
            </marker>
          </defs>
          {scheduled.map((t) => {
            const y = rowY.get(t.id)!
            const x1 = x(t.scheduledStart!)
            const w = x(t.scheduledEnd!) - x1 + DAY_W
            return (
              <g key={t.id}>
                <foreignObject x={0} y={y - 2} width={LABEL_W - 8} height={24}>
                  <Link to="/tasks/$taskId" params={{ taskId: t.id }} className="block truncate text-xs text-neutral-300 hover:text-neutral-50">{t.title}</Link>
                </foreignObject>
                <rect x={x1} y={y} width={w} height={20} rx={6} className={`${STATUS_FILL[t.status]} ${t.isBlocked ? 'stroke-rose-500' : ''}`} strokeWidth={t.isBlocked ? 1.5 : 0} opacity={0.9} />
                {t.assigneeName && (
                  <text x={x1 + 6} y={y + 14} fontSize="10" className="fill-[#0b1a10] font-semibold">{t.assigneeName.split(' ')[0]}</text>
                )}
              </g>
            )
          })}
        </svg>
      </div>
      {rest.length > 0 && (
        <div className="text-xs text-neutral-500">
          Sem agenda: {rest.map((t) => <Link key={t.id} to="/tasks/$taskId" params={{ taskId: t.id }} className="mr-2 underline decoration-neutral-700 hover:text-neutral-50">{t.title}</Link>)}
        </div>
      )}
    </div>
  )
}
