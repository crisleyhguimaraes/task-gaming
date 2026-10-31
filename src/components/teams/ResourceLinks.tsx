import { Plus, X } from 'lucide-react'
import type { FormEvent, ReactNode } from 'react'

type Item = { id: string; name: string; archived: boolean }
type Option = { id: string; name: string }

type Props = {
  title: string
  singular: string
  hint: ReactNode
  items: ReadonlyArray<Item>
  available: ReadonlyArray<Option>
  canLink: boolean
  onAdd: (id: string) => void
  onRemove: (item: Item) => void
}

/** Os vínculos da equipe com um tipo de recurso (pipeline, board): lista com remoção e, para quem pode vincular, o formulário de adição. */
export function ResourceLinks({ title, singular, hint, items, available, canLink, onAdd, onRemove }: Props) {
  const headingId = `links-${singular}`

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const id = String(new FormData(e.currentTarget).get('resourceId') ?? '')
    if (id) onAdd(id)
  }

  return (
    <section aria-labelledby={headingId} className="card space-y-3">
      <h2 id={headingId} className="text-sm font-semibold text-neutral-200">{title}</h2>
      <div className="text-sm text-neutral-400">{hint}</div>
      {items.length === 0 ? (
        <p className="text-sm text-neutral-500">Nenhum vínculo.</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {items.map((item) => (
            <li key={item.id} className={`inline-flex max-w-full items-center gap-1 rounded-full border border-neutral-700/60 bg-neutral-800/60 py-0.5 pl-2.5 text-xs ${canLink ? 'pr-1' : 'pr-2.5'}`}>
              <span className="truncate font-medium">{item.name}</span>
              {item.archived && <span className="text-amber-400">· arquivado</span>}
              {canLink && (
                <button type="button" onClick={() => onRemove(item)} aria-label={`Desvincular ${item.name}`} className="rounded-full p-1 text-neutral-500 hover:bg-neutral-700 hover:text-rose-400">
                  <X className="h-3 w-3" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canLink && available.length > 0 && (
        <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2">
          <select name="resourceId" aria-label={`Escolher ${singular} para vincular`} className="w-auto max-w-full py-1 text-xs">
            {available.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <button className="btn-ghost px-3 py-1 text-xs"><Plus className="h-3.5 w-3.5" /> Vincular</button>
        </form>
      )}
    </section>
  )
}
