import { Link, createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { ArrowLeft, Save, Trash2 } from 'lucide-react'
import * as React from 'react'
import { LeadFields, readLeadFields, readLeadStatus } from '#/components/leads/LeadFields'
import { StatusBadge } from '#/components/leads/StatusBadge'
import { ConvertLeadModal } from '#/components/pipeline/ConvertLeadModal'
import { Notes } from '#/components/Notes'
import { appRoute } from '#/lib/app-route'
import { leadSourceLabels, leadStatusLabels, leadStatuses, parseSource } from '#/lib/leads'
import { formatCents } from '#/lib/pipeline'
import { assignLead, claimLead, deleteLead, getLead, getMyTeamOptions, updateLead } from '#/server/leads'
import { can, isMemberOf } from '#/server/roles'

export const Route = createFileRoute('/_app/leads/$leadId')({
  loader: async ({ params }) => {
    const [detail, options] = await Promise.all([getLead({ data: { leadId: params.leadId } }), getMyTeamOptions()])
    return { ...detail, options }
  },
  component: LeadPage,
})

function LeadPage() {
  const { me } = appRoute.useRouteContext()
  const { lead, opportunities, notes, canEdit, canManage, options } = Route.useLoaderData()
  const router = useRouter()
  const navigate = useNavigate()
  const [error, setError] = React.useState<string | null>(null)
  const teamMembers = options.members.filter((m) => m.teamId === lead.teamId)
  const canClaim = !lead.ownerId && isMemberOf(me, lead.teamId) && can(me, 'lead.write', lead.teamId)

  async function act(fn: () => Promise<unknown>) {
    try {
      await fn()
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro')
    }
    router.invalidate()
  }

  async function remove() {
    if (!confirm(`Excluir ${lead.name}?`)) return
    try {
      await deleteLead({ data: { leadId: lead.id } })
      await router.invalidate()
      router.navigate({ to: '/leads' })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro')
    }
  }

  return (
    <div className="space-y-5">
      <Link to="/leads" className="inline-flex items-center gap-1 text-sm text-neutral-400 hover:text-neutral-50"><ArrowLeft className="h-4 w-4" /> Leads</Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{lead.name}</h1>
            <StatusBadge status={lead.status} />
          </div>
          <p className="text-sm text-neutral-400">
            {lead.teamName} · {lead.ownerName ? `responsável: ${lead.ownerName}` : 'no pool, sem responsável'} · criado em {new Date(lead.createdAt).toLocaleDateString('pt-BR')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canClaim && <button onClick={() => act(() => claimLead({ data: { leadId: lead.id } }))} className="btn-primary px-3 py-2 text-xs">Assumir</button>}
          {canEdit && can(me, 'opportunity.write', lead.teamId) && (
            <ConvertLeadModal lead={lead} onDone={(opportunityId) => navigate({ to: '/opportunities/$opportunityId', params: { opportunityId } })} />
          )}
          {canManage && (
            <select
              aria-label="Atribuir a"
              value={lead.ownerId ?? ''}
              onChange={(e) => e.target.value && act(() => assignLead({ data: { leadId: lead.id, ownerId: e.target.value } }))}
              className="w-auto py-2 text-xs"
            >
              <option value="" disabled>Atribuir a…</option>
              {teamMembers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          )}
          {canManage && <button onClick={remove} className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-900 hover:text-rose-400" title="Excluir lead"><Trash2 className="h-4 w-4" /></button>}
        </div>
      </div>
      {error && <p className="rounded-lg border border-rose-900/50 bg-rose-950/40 px-3 py-2 text-sm text-rose-400">{error}</p>}

      {canEdit ? (
        <form
          key={String(lead.updatedAt)}
          onSubmit={(e) => {
            e.preventDefault()
            const form = new FormData(e.currentTarget)
            act(() => updateLead({ data: { leadId: lead.id, ...readLeadFields(form), status: readLeadStatus(form) } }))
          }}
          className="card space-y-3"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <LeadFields lead={lead} />
            <div className="space-y-1">
              <label htmlFor="status">Status</label>
              <select id="status" name="status" defaultValue={lead.status}>
                {leadStatuses.map((s) => <option key={s} value={s}>{leadStatusLabels[s]}</option>)}
              </select>
            </div>
          </div>
          <button className="btn-primary"><Save className="h-4 w-4" /> Salvar</button>
        </form>
      ) : (
        <dl className="card grid gap-3 text-sm sm:grid-cols-2">
          {([['Empresa', lead.company], ['Origem', leadSourceLabels[parseSource(lead.source)]], ['E-mail', lead.email], ['Telefone', lead.phone]] as const).map(([label, value]) => (
            <div key={label}><dt className="text-xs text-neutral-500">{label}</dt><dd>{value || '—'}</dd></div>
          ))}
        </dl>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-neutral-300">Oportunidades</h2>
        <ul className="divide-y divide-neutral-800 rounded-2xl border border-neutral-800">
          {opportunities.map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <Link to="/opportunities/$opportunityId" params={{ opportunityId: o.id }} className="truncate font-medium hover:underline">{o.title}</Link>
              <div className="flex shrink-0 items-center gap-3 text-xs text-neutral-400">
                <span>{formatCents(o.amountCents)}</span>
                <span className="rounded-full border border-neutral-700 px-2 py-0.5">{o.stageName}</span>
              </div>
            </li>
          ))}
          {opportunities.length === 0 && <li className="px-4 py-6 text-center text-sm text-neutral-500">Nenhuma oportunidade para este lead.</li>}
        </ul>
      </section>

      <Notes target={{ type: 'lead', id: lead.id }} notes={notes} />
    </div>
  )
}
