import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowLeft, Upload } from 'lucide-react'
import Papa from 'papaparse'
import * as React from 'react'
import { ImportMapping } from '#/components/leads/ImportMapping'
import { ImportPreview } from '#/components/leads/ImportPreview'
import type { ImportChoices } from '#/components/leads/ImportPreview'
import { appRoute } from '#/lib/app-route'
import { applyColumnMapping, guessColumnMapping, maxImportRows } from '#/lib/leads'
import type { ColumnMapping } from '#/lib/leads'
import { getLeadOptions, importLeads, previewLeadImport } from '#/server/leads'
import type { ImportResult, RowPreview } from '#/server/leads-import.core'
import { can } from '#/server/roles'

export const Route = createFileRoute('/_app/leads/import')({
  loader: () => getLeadOptions(),
  component: ImportLeads,
})

type Table = { headers: Array<string>; data: Array<Array<string>> }

// NOTE: Excel em pt-BR exporta CSV em windows-1252; UTF-8 estrito falha nesses arquivos e caímos para ele.
async function readText(file: File) {
  const bytes = await file.arrayBuffer()
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

function ImportLeads() {
  const { me } = appRoute.useRouteContext()
  const { teams } = Route.useLoaderData()
  const [table, setTable] = React.useState<Table | null>(null)
  const [mapping, setMapping] = React.useState<ColumnMapping>({})
  const [teamId, setTeamId] = React.useState(teams.find((t) => t.id === me.teamId)?.id ?? teams[0]?.id ?? '')
  const [preview, setPreview] = React.useState<Array<RowPreview> | null>(null)
  const [choices, setChoices] = React.useState<ImportChoices>({ onDuplicate: 'skip', distribute: 'none' })
  const [result, setResult] = React.useState<ImportResult | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const rows = React.useMemo(() => (table ? applyColumnMapping(table.data, mapping) : []), [table, mapping])

  async function run(action: () => Promise<void>) {
    setBusy(true)
    try {
      await action()
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro')
    } finally {
      setBusy(false)
    }
  }

  async function onFile(file: File) {
    const [headers = [], ...data] = Papa.parse<Array<string>>(await readText(file), { skipEmptyLines: 'greedy' }).data
    if (data.length === 0) return setError('O arquivo não tem linhas além do cabeçalho')
    if (data.length > maxImportRows) return setError(`O arquivo tem ${data.length} linhas; o limite é ${maxImportRows} por importação`)
    setError(null)
    setTable({ headers, data })
    setMapping(guessColumnMapping(headers))
  }

  function reset() {
    setTable(null)
    setPreview(null)
    setResult(null)
    setError(null)
  }

  if (!can(me, 'lead.import')) return <p className="card text-sm text-neutral-400">Somente gestores importam leads.</p>

  return (
    <div className="space-y-5">
      <Link to="/leads" className="inline-flex items-center gap-1 text-sm text-neutral-400 hover:text-neutral-50"><ArrowLeft className="h-4 w-4" /> Leads</Link>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Importar leads</h1>
        <p className="text-sm text-neutral-500">Arquivo CSV com cabeçalho, até {maxImportRows} linhas.</p>
      </div>
      {error && <p className="rounded-lg border border-rose-900/50 bg-rose-950/40 px-3 py-2 text-sm text-rose-400">{error}</p>}

      {!table && (
        <div className="card space-y-2">
          <label htmlFor="file">Arquivo CSV</label>
          <input id="file" type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && run(() => onFile(e.target.files![0]!))} />
        </div>
      )}

      {table && !preview && !result && (
        <div className="card space-y-4">
          <p className="text-sm text-neutral-400">{table.data.length} linhas encontradas. Diga qual coluna é cada campo.</p>
          {teams.length > 1 && (
            <div className="space-y-1">
              <label htmlFor="teamId">Equipe dos leads</label>
              <select id="teamId" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          )}
          <ImportMapping headers={table.headers} mapping={mapping} onChange={setMapping} />
          <div className="flex gap-2">
            <button onClick={reset} className="btn-ghost">Trocar arquivo</button>
            <button disabled={busy || mapping.name === undefined || !teamId} onClick={() => run(async () => setPreview(await previewLeadImport({ data: { teamId, rows } })))} className="btn-primary">Ver prévia</button>
          </div>
        </div>
      )}

      {preview && !result && (
        <div className="space-y-4">
          <ImportPreview rows={rows} preview={preview} choices={choices} onChoices={setChoices} />
          <div className="flex gap-2">
            <button onClick={() => setPreview(null)} className="btn-ghost">Voltar ao mapeamento</button>
            <button disabled={busy} onClick={() => run(async () => setResult(await importLeads({ data: { teamId, rows, ...choices } })))} className="btn-primary">
              <Upload className="h-4 w-4" /> Importar
            </button>
          </div>
        </div>
      )}

      {result && <Result result={result} onRestart={reset} />}
    </div>
  )
}

function Result({ result, onRestart }: { result: ImportResult; onRestart: () => void }) {
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-3 gap-2">
        {([['Criados', result.created], ['Atualizados', result.updated], ['Ignorados', result.skipped]] as const).map(([label, value]) => (
          <div key={label} className="card"><dt className="text-xs text-neutral-500">{label}</dt><dd className="text-2xl font-black">{value}</dd></div>
        ))}
      </dl>
      {result.errors.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-neutral-300">Linhas com erro, não importadas</h2>
          <ul className="divide-y divide-neutral-800 rounded-2xl border border-neutral-800 text-sm">
            {result.errors.map((e) => (
              <li key={e.row} className="px-4 py-2"><span className="text-xs text-neutral-500">Linha {e.row + 1}</span> <span className="text-rose-400">{e.messages.join('; ')}</span></li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex gap-2">
        <button onClick={onRestart} className="btn-ghost">Nova importação</button>
        <Link to="/leads" className="btn-primary">Ver leads</Link>
      </div>
    </div>
  )
}
