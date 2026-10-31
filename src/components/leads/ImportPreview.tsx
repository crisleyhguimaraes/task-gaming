import type { RawLeadRow } from '#/lib/leads'
import type { RowPreview } from '#/server/leads-import.core'

export type ImportChoices = { onDuplicate: 'skip' | 'update'; distribute: 'none' | 'least_loaded' }

const statusLabel: Record<RowPreview['status'], string> = {
  new: 'Nova',
  duplicate: 'Já existe',
  repeated: 'Repetida no arquivo',
  invalid: 'Inválida',
}

const maxRowsShown = 100

type Props = {
  rows: Array<RawLeadRow>
  preview: Array<RowPreview>
  choices: ImportChoices
  onChoices: (choices: ImportChoices) => void
}

export function ImportPreview({ rows, preview, choices, onChoices }: Props) {
  const count = (status: RowPreview['status']) => preview.filter((p) => p.status === status).length
  const attention = preview.filter((p) => p.status !== 'new')

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(Object.keys(statusLabel) as Array<RowPreview['status']>).map((status) => (
          <div key={status} className="card">
            <dt className="text-xs text-neutral-500">{statusLabel[status]}</dt>
            <dd className="text-2xl font-black">{count(status)}</dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-3 sm:grid-cols-2">
        <fieldset className="space-y-1.5">
          <legend className="text-xs font-medium text-neutral-400">Quando o lead já existe</legend>
          <Radio name="onDuplicate" checked={choices.onDuplicate === 'skip'} onSelect={() => onChoices({ ...choices, onDuplicate: 'skip' })} label="Pular" />
          <Radio name="onDuplicate" checked={choices.onDuplicate === 'update'} onSelect={() => onChoices({ ...choices, onDuplicate: 'update' })} label="Atualizar com os dados do arquivo" />
        </fieldset>
        <fieldset className="space-y-1.5">
          <legend className="text-xs font-medium text-neutral-400">Responsável pelos novos leads</legend>
          <Radio name="distribute" checked={choices.distribute === 'none'} onSelect={() => onChoices({ ...choices, distribute: 'none' })} label="Ninguém: ficam no pool da equipe" />
          <Radio name="distribute" checked={choices.distribute === 'least_loaded'} onSelect={() => onChoices({ ...choices, distribute: 'least_loaded' })} label="Distribuir para quem tem menos oportunidades abertas" />
        </fieldset>
      </div>

      {attention.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-neutral-300">Linhas que pedem atenção</h2>
          <ul className="card divide-y divide-neutral-800 overflow-hidden p-0 text-sm">
            {attention.slice(0, maxRowsShown).map((p) => (
              <li key={p.row} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <span className="min-w-0 truncate">
                  <span className="text-xs text-neutral-500">Linha {p.row + 1}</span> {rows[p.row - 1]?.name || rows[p.row - 1]?.email || '(vazia)'}
                </span>
                <span className={`text-xs ${p.status === 'invalid' ? 'text-rose-400' : 'text-amber-300'}`}>
                  {statusLabel[p.status]}{p.messages.length > 0 && `: ${p.messages.join('; ')}`}
                </span>
              </li>
            ))}
          </ul>
          {attention.length > maxRowsShown && <p className="text-xs text-neutral-500">E mais {attention.length - maxRowsShown} linhas.</p>}
        </div>
      )}
    </div>
  )
}

function Radio({ name, checked, onSelect, label }: { name: string; checked: boolean; onSelect: () => void; label: string }) {
  return (
    <label className="flex items-center gap-2 text-sm text-neutral-200">
      <input type="radio" name={name} checked={checked} onChange={onSelect} className="h-4 w-4 p-0 accent-xp-400" /> {label}
    </label>
  )
}
