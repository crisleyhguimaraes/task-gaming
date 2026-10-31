import { Link, createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight, Compass, CircleDot, Plus, Upload, User, UsersRound } from 'lucide-react'
import * as React from 'react'
import { Avatar } from '#/components/Avatar'
import { FilterSelect } from '#/components/FilterSelect'
import { NewLeadModal } from '#/components/leads/NewLeadModal'
import { StatusBadge } from '#/components/leads/StatusBadge'
import { PageHeader } from '#/components/PageHeader'
import { SearchField } from '#/components/SearchField'
import { TopbarSlot } from '#/components/Topbar'
import { appRoute } from '#/lib/app-route'
import { plural } from '#/lib/format'
import { leadSourceLabels, leadSources, leadStatusLabels, leadStatuses, leadsPageSize, parseSource, poolOwnerFilter } from '#/lib/leads'
import { uniqueById } from '#/lib/unique'
import { claimLead, getMyTeamOptions, leadSearchSchema, listLeads } from '#/server/leads'
import { can, isMemberOf } from '#/server/roles'

export const Route = createFileRoute('/_app/leads/')({
  staticData: { pageWidth: 'full' },
  validateSearch: leadSearchSchema,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const [list, options] = await Promise.all([listLeads({ data: deps }), getMyTeamOptions()])
    return { ...list, options }
  },
  component: Leads,
})

const COLUMNS = ['Lead', 'Equipe', 'Dono', 'Origem', 'Status']
const HEADER_CELL = 'px-4 py-2.5 text-left text-xs font-medium text-neutral-500'

type Search = ReturnType<typeof Route.useSearch>
type TeamOptions = Awaited<ReturnType<typeof getMyTeamOptions>>
type LeadItem = Awaited<ReturnType<typeof listLeads>>['leads'][number]

function Leads() {
  const { me } = appRoute.useRouteContext()
  const { leads, total, page, options } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: '/leads/' })
  const router = useRouter()
  const [creating, setCreating] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [query, setQuery] = React.useState(search.search ?? '')
  const set = (patch: Partial<Search>) => navigate({ search: (prev) => ({ ...prev, page: 1, ...patch }) })
  const goToPage = (target: number) => navigate({ search: (prev) => ({ ...prev, page: target }) })
  const lastPage = Math.max(1, Math.ceil(total / leadsPageSize))
  const firstShown = (page - 1) * leadsPageSize + 1

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
    <div className="space-y-5">
      <TopbarSlot>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            set({ search: query.trim() || undefined })
          }}
        >
          <SearchField value={query} onChange={setQuery} placeholder="Buscar por nome, empresa ou e-mail…" />
        </form>
      </TopbarSlot>
      <PageHeader title="Leads" subtitle={plural(total, 'lead', 'leads')}>
        {can(me, 'lead.import') && <Link to="/leads/import" className="btn-ghost px-3 py-2 text-xs"><Upload className="h-4 w-4" /> Importar</Link>}
        {can(me, 'lead.write') && <button onClick={() => setCreating(true)} className="btn-primary px-3 py-2 text-xs"><Plus className="h-4 w-4" /> Novo lead</button>}
      </PageHeader>

      <LeadFilters search={search} options={options} onChange={set} />
      {error && <p className="rounded-xl border border-rose-900/50 bg-rose-950/40 px-3 py-2 text-sm text-rose-400">{error}</p>}

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-sm">
            <thead className="bg-neutral-950/60">
              <tr className="border-b border-neutral-800">
                {COLUMNS.map((name) => <th key={name} scope="col" className={HEADER_CELL}>{name}</th>)}
                <th scope="col" className={HEADER_CELL}><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <LeadRow
                  key={l.id}
                  lead={l}
                  onClaim={!l.ownerName && isMemberOf(me, l.teamId) && can(me, 'lead.write', l.teamId) ? () => claim(l.id) : undefined}
                />
              ))}
              {leads.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-neutral-500">Nenhum lead encontrado.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-neutral-800 px-4 py-3 text-xs text-neutral-500">
          <span>{total === 0 ? '0 leads' : `${firstShown}–${firstShown + leads.length - 1} de ${total}`}</span>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => goToPage(page - 1)} className="btn-ghost px-2.5 py-1.5 text-xs" aria-label="Página anterior"><ChevronLeft className="h-4 w-4" /></button>
            <button disabled={page >= lastPage} onClick={() => goToPage(page + 1)} className="btn-ghost px-2.5 py-1.5 text-xs" aria-label="Próxima página"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
      </div>

      <NewLeadModal open={creating} onClose={() => setCreating(false)} options={options} me={me} />
    </div>
  )
}

function LeadFilters({ search, options, onChange }: { search: Search; options: TeamOptions; onChange: (patch: Partial<Search>) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {options.teams.length > 1 && (
        <FilterSelect label="Equipe" icon={UsersRound} value={search.teamId ?? ''} onChange={(v) => onChange({ teamId: v || undefined, ownerId: undefined })}>
          <option value="">Todas as equipes</option>
          {options.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </FilterSelect>
      )}
      <FilterSelect label="Responsável" icon={User} value={search.ownerId ?? ''} onChange={(v) => onChange({ ownerId: v || undefined })}>
        <option value="">Todos os responsáveis</option>
        <option value={poolOwnerFilter}>Pool (sem dono)</option>
        {uniqueById(options.members.filter((m) => !search.teamId || m.teamId === search.teamId)).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </FilterSelect>
      <FilterSelect label="Status" icon={CircleDot} value={search.status ?? ''} onChange={(v) => onChange({ status: leadStatuses.find((s) => s === v) })}>
        <option value="">Todos os status</option>
        {leadStatuses.map((s) => <option key={s} value={s}>{leadStatusLabels[s]}</option>)}
      </FilterSelect>
      <FilterSelect label="Origem" icon={Compass} value={search.source ?? ''} onChange={(v) => onChange({ source: leadSources.find((s) => s === v) })}>
        <option value="">Todas as origens</option>
        {leadSources.map((s) => <option key={s} value={s}>{leadSourceLabels[s]}</option>)}
      </FilterSelect>
    </div>
  )
}

function LeadRow({ lead, onClaim }: { lead: LeadItem; onClaim?: () => void }) {
  return (
    <tr className="border-b border-neutral-800 last:border-b-0 hover:bg-neutral-950/50">
      <td className="px-4 py-3">
        <Link to="/leads/$leadId" params={{ leadId: lead.id }} className="block max-w-[26rem] truncate font-medium hover:underline">{lead.name}</Link>
        <div className="max-w-[26rem] truncate text-xs text-neutral-500">
          {[lead.company, lead.email, lead.phone].filter(Boolean).join(' · ') || 'Sem dados de contato'}
        </div>
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-neutral-400">{lead.teamName}</td>
      <td className="px-4 py-3 whitespace-nowrap">
        {lead.ownerName ? (
          <span className="inline-flex items-center gap-2"><Avatar name={lead.ownerName} size="sm" />{lead.ownerName}</span>
        ) : (
          <span className="text-neutral-500 italic">Pool</span>
        )}
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-neutral-400">{leadSourceLabels[parseSource(lead.source)]}</td>
      <td className="px-4 py-3"><StatusBadge status={lead.status} /></td>
      <td className="px-4 py-3 text-right">
        {onClaim && <button onClick={onClaim} aria-label={`Assumir ${lead.name}`} className="btn-ghost px-2.5 py-1 text-xs">Assumir</button>}
      </td>
    </tr>
  )
}
