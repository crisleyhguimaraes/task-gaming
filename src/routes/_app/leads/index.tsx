import { Link, createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight, Plus, Search, Upload } from 'lucide-react'
import * as React from 'react'
import { NewLeadModal } from '#/components/leads/NewLeadModal'
import { StatusBadge } from '#/components/leads/StatusBadge'
import { appRoute } from '#/lib/app-route'
import { leadSourceLabels, leadSources, leadStatusLabels, leadStatuses, leadsPageSize, parseSource, poolOwnerFilter } from '#/lib/leads'
import { claimLead, getMyTeamOptions, leadSearchSchema, listLeads } from '#/server/leads'
import { can, isMemberOf } from '#/server/roles'

export const Route = createFileRoute('/_app/leads/')({
  validateSearch: leadSearchSchema,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const [list, options] = await Promise.all([listLeads({ data: deps }), getMyTeamOptions()])
    return { ...list, options }
  },
  component: Leads,
})

function Leads() {
  const { me } = appRoute.useRouteContext()
  const { leads, total, page, options } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: '/leads/' })
  const router = useRouter()
  const [creating, setCreating] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const set = (patch: Partial<typeof search>) => navigate({ search: (prev) => ({ ...prev, page: 1, ...patch }) })
  const lastPage = Math.max(1, Math.ceil(total / leadsPageSize))

  async function claim(leadId: string) {
    try {
      await claimLead({ data: { leadId } })
      setError(null)
      router.invalidate()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro')
      router.invalidate()
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Leads</h1>
        <div className="flex items-center gap-2">
          {can(me, 'lead.import') && <Link to="/leads/import" className="btn-ghost px-3 py-2 text-xs"><Upload className="h-4 w-4" /> Importar</Link>}
          {can(me, 'lead.write') && <button onClick={() => setCreating(true)} className="btn-primary px-3 py-2 text-xs"><Plus className="h-4 w-4" /> Novo lead</button>}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            set({ search: String(new FormData(e.currentTarget).get('q')).trim() || undefined })
          }}
          className="relative min-w-[180px] flex-1"
        >
          <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-neutral-500" />
          <input name="q" defaultValue={search.search ?? ''} placeholder="Nome, empresa ou e-mail" aria-label="Buscar leads" className="pl-9" />
        </form>
        {options.teams.length > 1 && (
          <select value={search.teamId ?? ''} onChange={(e) => set({ teamId: e.target.value || undefined, ownerId: undefined })} aria-label="Equipe" className="w-auto">
            <option value="">Todas as equipes</option>
            {options.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
        <select value={search.ownerId ?? ''} onChange={(e) => set({ ownerId: e.target.value || undefined })} aria-label="Responsável" className="w-auto">
          <option value="">Todos os responsáveis</option>
          <option value={poolOwnerFilter}>Pool (sem dono)</option>
          {options.members.filter((m) => !search.teamId || m.teamId === search.teamId).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <select value={search.status ?? ''} onChange={(e) => set({ status: (e.target.value || undefined) as typeof search.status })} aria-label="Status" className="w-auto">
          <option value="">Todos os status</option>
          {leadStatuses.map((s) => <option key={s} value={s}>{leadStatusLabels[s]}</option>)}
        </select>
        <select value={search.source ?? ''} onChange={(e) => set({ source: (e.target.value || undefined) as typeof search.source })} aria-label="Origem" className="w-auto">
          <option value="">Todas as origens</option>
          {leadSources.map((s) => <option key={s} value={s}>{leadSourceLabels[s]}</option>)}
        </select>
      </div>
      {error && <p className="rounded-lg border border-rose-900/50 bg-rose-950/40 px-3 py-2 text-sm text-rose-400">{error}</p>}

      <ul className="divide-y divide-neutral-800 rounded-2xl border border-neutral-800">
        {leads.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <Link to="/leads/$leadId" params={{ leadId: l.id }} className="truncate font-medium hover:underline">{l.name}</Link>
              <div className="truncate text-xs text-neutral-500">
                {[l.company, l.email, l.phone].filter(Boolean).join(' · ') || 'Sem dados de contato'}
              </div>
            </div>
            <div className="flex items-center gap-3 text-xs text-neutral-400">
              <span className="hidden sm:inline">{leadSourceLabels[parseSource(l.source)]}</span>
              <StatusBadge status={l.status} />
              {l.ownerName ? (
                <span>{l.ownerName}</span>
              ) : (
                <>
                  <span className="text-neutral-500">Pool · {l.teamName}</span>
                  {isMemberOf(me, l.teamId) && can(me, 'lead.write') && <button onClick={() => claim(l.id)} className="btn-ghost px-2.5 py-1 text-xs">Assumir</button>}
                </>
              )}
            </div>
          </li>
        ))}
        {leads.length === 0 && <li className="px-4 py-8 text-center text-sm text-neutral-500">Nenhum lead encontrado.</li>}
      </ul>

      <div className="flex items-center justify-between text-xs text-neutral-500">
        <span>{total === 0 ? '0 leads' : `${(page - 1) * leadsPageSize + 1}–${(page - 1) * leadsPageSize + leads.length} de ${total}`}</span>
        <div className="flex gap-2">
          <button disabled={page <= 1} onClick={() => navigate({ search: (prev) => ({ ...prev, page: page - 1 }) })} className="btn-ghost px-2.5 py-1.5 text-xs" aria-label="Página anterior"><ChevronLeft className="h-4 w-4" /></button>
          <button disabled={page >= lastPage} onClick={() => navigate({ search: (prev) => ({ ...prev, page: page + 1 }) })} className="btn-ghost px-2.5 py-1.5 text-xs" aria-label="Próxima página"><ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>

      <NewLeadModal open={creating} onClose={() => setCreating(false)} options={options} me={me} />
    </div>
  )
}
