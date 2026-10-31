import type { LucideIcon } from 'lucide-react'
import { ChevronDown } from 'lucide-react'

type Props = { label: string; icon: LucideIcon; value: string; onChange: (value: string) => void; children: React.ReactNode }

export function FilterSelect({ label, icon: Icon, value, onChange, children }: Props) {
  return (
    <label className="relative inline-flex items-center">
      <Icon className="pointer-events-none absolute left-3 h-4 w-4 text-neutral-500" />
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className="h-10 w-auto appearance-none rounded-xl bg-neutral-900 py-0 pr-9 pl-9 font-medium">
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 h-4 w-4 text-neutral-500" />
    </label>
  )
}
