import { Pencil, Plus, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import * as React from 'react'
import { TeamChips } from '../teams/TeamChips'
import type { CatalogItem } from './model'
import { useAttempt } from './model'

type Props<T extends CatalogItem> = {
  noun: string
  createLabel: string
  items: ReadonlyArray<T>
  summary: (item: T) => ReactNode
  renderForm: (item: T | null, close: () => void) => ReactNode
  onDelete: (item: T) => Promise<unknown>
}

const NEW = 'new'

/** Lista de um catálogo (metas ou pontuações): o formulário abre no lugar do item editado, ou no topo para um novo. */
export function CatalogPanel<T extends CatalogItem>({ noun, createLabel, items, summary, renderForm, onDelete }: Props<T>) {
  const [editing, setEditing] = React.useState<string | null>(null)
  const { error, attempt } = useAttempt()
  const close = () => setEditing(null)

  return (
    <div className="space-y-4">
      {editing === NEW ? (
        <div className="card">{renderForm(null, close)}</div>
      ) : (
        <button type="button" onClick={() => setEditing(NEW)} className="btn-primary"><Plus className="h-4 w-4" /> {createLabel}</button>
      )}
      {error && <p role="alert" className="text-sm text-rose-400">{error}</p>}
      <ul className="divide-y divide-neutral-800 rounded-2xl border border-neutral-800">
        {items.map((item) => (
          <li key={item.id} className="space-y-2 px-4 py-3">
            {editing === item.id ? (
              renderForm(item, close)
            ) : (
              <CatalogRow
                item={item}
                noun={noun}
                summary={summary(item)}
                onEdit={() => setEditing(item.id)}
                onDelete={() => attempt(() => onDelete(item))}
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

type RowProps = { item: CatalogItem; noun: string; summary: ReactNode; onEdit: () => void; onDelete: () => void }

function CatalogRow({ item, noun, summary, onEdit, onDelete }: RowProps) {
  const confirmDelete = () => confirm(`Excluir ${item.name}? As equipes que usam esta ${noun} voltam à padrão.`) && onDelete()
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate text-sm font-semibold">{item.name}</h3>
          {item.isDefault && <span className="rounded-full border border-xp-500/40 px-2 py-0.5 text-xs text-xp-400">Padrão</span>}
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={onEdit} aria-label={`Editar ${item.name}`} title="Editar" className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-900 hover:text-neutral-50">
            <Pencil className="h-4 w-4" />
          </button>
          {!item.isDefault && (
            <button type="button" onClick={confirmDelete} aria-label={`Excluir ${item.name}`} title="Excluir" className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-900 hover:text-rose-400">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      {summary}
      {item.isDefault && <p className="text-xs text-neutral-500">Usado pelas equipes sem vínculo{item.teams.length ? ':' : ': nenhuma no momento.'}</p>}
      {(item.teams.length > 0 || !item.isDefault) && <TeamChips teams={item.teams} emptyText={`Nenhuma equipe usa esta ${noun}.`} />}
    </>
  )
}
