import * as React from 'react'

type Props = {
  pct: number
  size?: number
  stroke?: number
  className?: string // cor do traço (text-*)
  children?: React.ReactNode
}

/** Anel de progresso. Anima do zero até o valor uma vez, na montagem (respeita reduced-motion via CSS). */
export function Ring({ pct, size = 96, stroke = 9, className = 'text-xp-400', children }: Props) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])
  const offset = c * (1 - Math.min(100, Math.max(0, mounted ? pct : 0)) / 100)
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-neutral-800" />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={offset}
          className={`${className} transition-[stroke-dashoffset] duration-1000 ease-out`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  )
}
