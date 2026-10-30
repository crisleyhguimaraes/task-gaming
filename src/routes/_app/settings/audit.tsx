import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { Download } from 'lucide-react'
import * as React from 'react'
import { z } from 'zod'
import { AuditEntry, entityLabels } from '#/components/AuditEntry'
import { auditActionLabels, auditActions } from '#/lib/audit'
import { downloadCsv } from '#/lib/download-csv'
import { getAuditActors, listAuditPage } from '#/server/audit-view'
import { exportAuditCsv } from '#/server/exports'

const searchSchema = z.object({
  action: z.enum(auditActions).optional(),
  entityType: z.string().optional(),
  actorId: z.string().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
})
type Search = z.infer<typeof searchSchema>

function toFilters({ from, to, ...rest }: Search) {
  return {
    ...rest,
    from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
    to: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
  }
}

export const Route = createFileRoute('/_app/settings/audit')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const [page, actors] = await Promise.all([listAuditPage({ data: toFilters(deps) }), getAuditActors()])
    return { page, actors }
  },
  component: Audit,
})

type AuditPage = Awaited<ReturnType<typeof listAuditPage>>

function Audit() {
  const { page, actors } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const [error, setError] = React.useState<string | null>(null)

  function applyFilters(form: HTMLFormElement) {
    const f = new FormData(form)
    const value = (name: string) => String(f.get(name)) || undefined
    navigate({
      search: {
        action: value('action') as Search['action'],
        entityType: value('entityType'),
        actorId: value('actorId'),
        from: value('from'),
        to: value('to'),
      },
    })
  }

  async function exportCsv() {
    try {
      downloadCsv(await exportAuditCsv({ data: toFilters(search) }))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro')
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-neutral-400">Configurações</p>
          <h1 className="text-2xl font-bold tracking-tight">Auditoria</h1>
        </div>
        <button type="button" onClick={exportCsv} className="btn-ghost"><Download className="h-4 w-4" /> Exportar CSV</button>
      </div>

      <form
        key={JSON.stringify(search)}
        onSubmit={(e) => {
          e.preventDefault()
          applyFilters(e.currentTarget)
        }}
        className="card grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
      >
        <div className="space-y-1">
          <label htmlFor="action">Ação</label>
          <select id="action" name="action" defaultValue={search.action ?? ''}>
            <option value="">Todas</option>
            {auditActions.map((a) => <option key={a} value={a}>{auditActionLabels[a]}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="entityType">Entidade</label>
          <select id="entityType" name="entityType" defaultValue={search.entityType ?? ''}>
            <option value="">Todas</option>
            {Object.entries(entityLabels).map(([type, label]) => <option key={type} value={type}>{label}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="actorId">Ator</label>
          <select id="actorId" name="actorId" defaultValue={search.actorId ?? ''}>
            <option value="">Todos</option>
            {actors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="from">De</label>
          <input id="from" name="from" type="date" defaultValue={search.from ?? ''} />
        </div>
        <div className="space-y-1">
          <label htmlFor="to">Até</label>
          <input id="to" name="to" type="date" defaultValue={search.to ?? ''} />
        </div>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-5">
          <button className="btn-primary">Filtrar</button>
          <Link to="/settings/audit" search={{}} className="btn-ghost">Limpar</Link>
        </div>
      </form>
      {error && <p className="text-sm text-rose-400">{error}</p>}

      <AuditList key={JSON.stringify(search)} first={page} filters={toFilters(search)} />
    </div>
  )
}

function AuditList({ first, filters }: { first: AuditPage; filters: ReturnType<typeof toFilters> }) {
  const [events, setEvents] = React.useState(first.events)
  const [nextCursor, setNextCursor] = React.useState(first.nextCursor)
  const [error, setError] = React.useState<string | null>(null)

  async function loadMore() {
    if (!nextCursor) return
    try {
      const more = await listAuditPage({ data: { ...filters, cursor: nextCursor } })
      setEvents([...events, ...more.events])
      setNextCursor(more.nextCursor)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro')
    }
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-neutral-800 rounded-2xl border border-neutral-800">
        {events.map((e) => <li key={e.id}><AuditEntry event={e} /></li>)}
        {events.length === 0 && <li className="px-4 py-6 text-center text-sm text-neutral-500">Nenhum evento para esses filtros.</li>}
      </ul>
      {error && <p className="text-sm text-rose-400">{error}</p>}
      {nextCursor && <button type="button" onClick={loadMore} className="btn-ghost mx-auto">Carregar mais</button>}
    </div>
  )
}
