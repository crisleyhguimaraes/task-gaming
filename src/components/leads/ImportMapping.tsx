import { leadColumnLabels, leadColumns } from '#/lib/leads'
import type { ColumnMapping } from '#/lib/leads'

type Props = { headers: Array<string>; mapping: ColumnMapping; onChange: (mapping: ColumnMapping) => void }

export function ImportMapping({ headers, mapping, onChange }: Props) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {leadColumns.map((column) => (
        <div key={column} className="space-y-1">
          <label htmlFor={`map-${column}`}>{leadColumnLabels[column]}{column === 'name' && ' (obrigatório)'}</label>
          <select
            id={`map-${column}`}
            value={mapping[column] ?? ''}
            onChange={(e) => onChange({ ...mapping, [column]: e.target.value === '' ? undefined : Number(e.target.value) })}
          >
            <option value="">{column === 'name' ? 'Escolha a coluna' : 'Não importar'}</option>
            {headers.map((header, index) => <option key={index} value={index}>{header.trim() || `Coluna ${index + 1}`}</option>)}
          </select>
        </div>
      ))}
    </div>
  )
}
