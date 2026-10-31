import type { LucideIcon } from 'lucide-react'

export function KpiCard({ icon: Icon, label, value, hint }: { icon: LucideIcon; label: string; value: string; hint?: string }) {
  return (
    <div className="card flex flex-col gap-2">
      <div className="flex items-center gap-2 text-sm text-neutral-400">
        <Icon className="h-4 w-4" />
        {label}
      </div>
      <div className="text-[28px] leading-8 font-bold tracking-tight tabular-nums">{value}</div>
      {hint && <div className="text-xs text-neutral-500">{hint}</div>}
    </div>
  )
}
