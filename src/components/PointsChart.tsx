import * as React from 'react'

type Point = { day: string; points: number }
const W = 560
const H = 160
const PAD = { l: 8, r: 8, t: 12, b: 24 }

/** Área de uma série (pontos/dia). Linha 2px em xp-600 (validado p/ fundo escuro), crosshair + tooltip no hover. */
export function PointsChart({ data }: { data: Array<Point> }) {
  const [hover, setHover] = React.useState<number | null>(null)
  const max = Math.max(10, ...data.map((d) => d.points))
  const x = (i: number) => PAD.l + (i / Math.max(1, data.length - 1)) * (W - PAD.l - PAD.r)
  const y = (v: number) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b)
  const line = data.map((d, i) => `${i ? 'L' : 'M'}${x(i)},${y(d.points)}`).join(' ')
  const area = `${line} L${x(data.length - 1)},${y(0)} L${x(0)},${y(0)} Z`
  const fmt = (d: string) => `${d.slice(8)}/${d.slice(5, 7)}`
  const total = data.reduce((a, d) => a + d.points, 0)

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <div className="text-2xl font-bold">
          {total} <span className="text-sm font-medium text-neutral-400">pts em 14 dias</span>
        </div>
        {hover !== null && (
          <div className="text-sm text-neutral-300">
            {fmt(data[hover]!.day)}: <b>{data[hover]!.points} pts</b>
          </div>
        )}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-40 w-full"
        role="img"
        aria-label={`Pontos por dia nos últimos ${data.length} dias`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const px = ((e.clientX - r.left) / r.width) * W
          setHover(Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (data.length - 1)))
        }}
      >
        <defs>
          <linearGradient id="pts-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--color-xp-600)" stopOpacity="0.35" />
            <stop offset="1" stopColor="var(--color-xp-600)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.5, 1].map((f) => (
          <line key={f} x1={PAD.l} x2={W - PAD.r} y1={y(max * f)} y2={y(max * f)} stroke="var(--color-neutral-800)" strokeDasharray="2 4" />
        ))}
        <path d={area} fill="url(#pts-fill)" />
        <path d={line} fill="none" stroke="var(--color-xp-600)" strokeWidth="2" strokeLinejoin="round" />
        {hover !== null && data[hover] && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} stroke="var(--color-neutral-600)" />
            <circle cx={x(hover)} cy={y(data[hover].points)} r="5" fill="var(--color-xp-400)" stroke="var(--color-neutral-900)" strokeWidth="2" />
          </g>
        )}
        {data.map((d, i) => (i % 3 === 0 || i === data.length - 1) && (
          <text key={d.day} x={x(i)} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--color-neutral-500)">{fmt(d.day)}</text>
        ))}
      </svg>
    </div>
  )
}
