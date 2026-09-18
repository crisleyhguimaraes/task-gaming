import type { LucideIcon } from 'lucide-react'

export type Tone = 'green' | 'cyan' | 'violet' | 'pink' | 'gold'

/** Tile de estatística: ícone em quadradinho gradiente + valor + rótulo. */
export function StatTile({ icon: Icon, tone, value, label }: { icon: LucideIcon; tone: Tone; value: React.ReactNode; label: string }) {
  return (
    <div className="card flex items-center gap-3 py-3">
      <span className={`tile-${tone}`}>
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <div className="text-sm text-neutral-400">{label}</div>
        <div className="truncate text-xl leading-tight font-bold lg:text-2xl">{value}</div>
      </div>
    </div>
  )
}

/** Pill compacta do topo (Liga / Dias na empresa / Sequência). */
export function Pill({ icon: Icon, tone, label, value }: { icon: LucideIcon; tone: Tone; label: string; value: React.ReactNode }) {
  return (
    <div className="card flex items-center gap-3 py-3">
      <span className={`tile-${tone} h-10 w-10`}>
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <div className="text-xs text-neutral-400">{label}</div>
        <div className="text-lg leading-tight font-semibold">{value}</div>
      </div>
    </div>
  )
}
