import type { LucideIcon } from 'lucide-react'

type Option<T extends string> = { id: T; label: string; icon: LucideIcon }

export function ViewSwitcher<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: ReadonlyArray<Option<T>>; onChange: (id: T) => void }) {
  return (
    <div role="group" aria-label={label} className="flex gap-0.5 rounded-xl border border-neutral-800 bg-neutral-900 p-0.5">
      {options.map(({ id, label: text, icon: Icon }) => (
        <button
          key={id}
          type="button"
          aria-pressed={id === value}
          title={text}
          onClick={() => onChange(id)}
          className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ${id === value ? 'bg-brand-soft text-brand-ink' : 'text-neutral-500 hover:text-neutral-50'}`}
        >
          <Icon className="h-4 w-4" />
          <span className="hidden md:inline">{text}</span>
        </button>
      ))}
    </div>
  )
}
