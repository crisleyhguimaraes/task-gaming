import { WEEKDAYS } from './model'

export function WeekdayChips({ days }: { days: ReadonlyArray<number> }) {
  return (
    <ul aria-label="Dias da semana" className="flex flex-wrap gap-1">
      {WEEKDAYS.map(({ day, short, long }) => {
        const active = days.includes(day)
        return (
          <li
            key={day}
            aria-label={`${long}: ${active ? 'ativo' : 'sem meta'}`}
            className={`rounded-md px-1.5 py-0.5 text-xs font-medium ${active ? 'bg-xp-400/15 text-xp-400' : 'text-neutral-600'}`}
          >
            {short}
          </li>
        )
      })}
    </ul>
  )
}

type PickerProps = { days: ReadonlyArray<number>; onChange: (days: Array<number>) => void }

export function WeekdayPicker({ days, onChange }: PickerProps) {
  const toggle = (day: number) => onChange(days.includes(day) ? days.filter((d) => d !== day) : [...days, day])
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-xs font-medium text-neutral-400">Dias com meta</legend>
      <div className="flex flex-wrap gap-1.5">
        {WEEKDAYS.map(({ day, short, long }) => (
          <button
            key={day}
            type="button"
            aria-pressed={days.includes(day)}
            aria-label={long}
            onClick={() => toggle(day)}
            className={`min-w-11 rounded-lg border px-2 py-1.5 text-xs font-semibold ${days.includes(day) ? 'border-xp-500/60 bg-xp-400/15 text-xp-400' : 'border-neutral-700/60 text-neutral-400 hover:bg-neutral-800'}`}
          >
            {short}
          </button>
        ))}
      </div>
      <p className="text-xs text-neutral-500">Nos outros dias a meta é nenhuma (dia livre) e a sequência não quebra sem tarefa.</p>
      <p role="note" className="rounded-lg border border-amber-700/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
        Mudar os dias recalcula a sequência de todo mundo, inclusive a passada.
      </p>
    </fieldset>
  )
}
