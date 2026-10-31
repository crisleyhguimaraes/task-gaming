import { Archive, ArchiveRestore } from 'lucide-react'
import type { FormEvent, ReactNode } from 'react'
import { TeamChips } from './TeamChips'

type Props = {
  name: string
  archived: boolean
  badge?: string
  teams: ReadonlyArray<{ id: string; name: string }>
  emptyTeamsText: string
  canManage: boolean
  canArchive?: boolean
  extra?: ReactNode
  act: (fn: () => Promise<unknown>) => Promise<void>
  onRename: (name: string) => Promise<unknown>
  onArchive: () => Promise<unknown>
  onRestore: () => Promise<unknown>
}

/** Linha de pipeline ou board: renomear, arquivar e restaurar, com as equipes vinculadas em leitura. */
export function ManagedResourceItem({ name, archived, badge, teams, emptyTeamsText, canManage, canArchive = true, extra, act, onRename, onArchive, onRestore }: Props) {
  const editable = canManage && !archived

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    act(() => onRename(String(new FormData(e.currentTarget).get('name'))))
  }

  return (
    <li className="space-y-2 px-4 py-3">
      <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2">
        <input name="name" defaultValue={name} aria-label={`Nome de ${name}`} required minLength={2} maxLength={80} disabled={!editable} className="min-w-[140px] flex-1" />
        {badge && <span className="rounded-full border border-xp-500/40 px-2 py-0.5 text-xs text-xp-400">{badge}</span>}
        {archived && <span className="rounded-full border border-amber-700/50 px-2 py-0.5 text-xs text-amber-400">Arquivado</span>}
        {editable && <button className="btn-ghost px-3 py-2 text-xs">Salvar</button>}
        {extra}
        {canManage && canArchive && (archived ? (
          <button type="button" onClick={() => act(onRestore)} className="btn-ghost px-3 py-2 text-xs"><ArchiveRestore className="h-4 w-4" /> Restaurar</button>
        ) : (
          <button type="button" onClick={() => act(onArchive)} aria-label={`Arquivar ${name}`} title="Arquivar" className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-900 hover:text-amber-400">
            <Archive className="h-4 w-4" />
          </button>
        ))}
      </form>
      <TeamChips teams={teams} emptyText={emptyTeamsText} />
    </li>
  )
}
