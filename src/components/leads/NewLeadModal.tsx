import { Link, useRouter } from '@tanstack/react-router'
import { AlertTriangle } from 'lucide-react'
import * as React from 'react'
import { Modal } from '#/components/Modal'
import { messageOf } from '#/components/useAttempt'
import { createLead } from '#/server/leads'
import type { getMyTeamOptions } from '#/server/leads'
import type { DuplicateCandidate } from '#/server/leads.core'
import type { AuthCtx } from '#/server/roles'
import { canManage, defaultTeamId } from '#/server/roles'
import { LeadFields, readLeadFields } from './LeadFields'

type LeadOptions = Awaited<ReturnType<typeof getMyTeamOptions>>

type Props = { open: boolean; onClose: () => void; options: LeadOptions; me: Pick<AuthCtx, 'userId' | 'role' | 'memberships'> }

export function NewLeadModal({ open, onClose, ...rest }: Props) {
  return (
    <Modal open={open} onClose={onClose}>
      <NewLeadForm onClose={onClose} {...rest} />
    </Modal>
  )
}

function NewLeadForm({ onClose, options, me }: Omit<Props, 'open'>) {
  const router = useRouter()
  const formRef = React.useRef<HTMLFormElement>(null)
  const [teamId, setTeamId] = React.useState(defaultTeamId(me, options.teams))
  const [duplicates, setDuplicates] = React.useState<Array<DuplicateCandidate>>([])
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const owners = options.members.filter((m) => m.teamId === teamId && (canManage(me, { teamId }) || m.id === me.userId))

  async function submit(force: boolean) {
    const form = new FormData(formRef.current!)
    setBusy(true)
    try {
      const result = await createLead({ data: { ...readLeadFields(form), teamId, ownerId: String(form.get('ownerId')) || null, force } })
      if (!result.created) {
        setDuplicates(result.duplicates)
        setError(null)
        return
      }
      onClose()
      await router.invalidate()
      router.navigate({ to: '/leads/$leadId', params: { leadId: result.lead.id } })
    } catch (e) {
      setError(messageOf(e, 'Erro ao criar'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault()
        submit(false)
      }}
      onChange={() => duplicates.length > 0 && setDuplicates([])}
      className="space-y-4 rounded-3xl border border-neutral-800 bg-neutral-950 p-6"
    >
      <h2 className="text-lg font-bold">Novo lead</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <LeadFields />
        {options.teams.length > 1 && (
          <div className="space-y-1">
            <label htmlFor="teamId">Equipe</label>
            <select id="teamId" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              {options.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        )}
        <div className="space-y-1">
          <label htmlFor="ownerId">Responsável</label>
          <select id="ownerId" name="ownerId" key={teamId} defaultValue={owners.some((m) => m.id === me.userId) ? me.userId : ''}>
            <option value="">Pool da equipe</option>
            {owners.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
      </div>
      {duplicates.length > 0 && <DuplicateWarning duplicates={duplicates} />}
      {error && <p className="text-sm text-rose-400">{error}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onClose} className="btn-ghost">Cancelar</button>
        {duplicates.length > 0 ? (
          <button type="button" disabled={busy} onClick={() => submit(true)} className="btn-white">Criar mesmo assim</button>
        ) : (
          <button disabled={busy || !teamId} className="btn-primary">Criar lead</button>
        )}
      </div>
    </form>
  )
}

function DuplicateWarning({ duplicates }: { duplicates: Array<DuplicateCandidate> }) {
  return (
    <div role="alert" className="space-y-2 rounded-xl border border-amber-800/50 bg-amber-950/40 p-3 text-sm text-amber-300">
      <p className="flex items-center gap-1.5 font-semibold"><AlertTriangle className="h-4 w-4 shrink-0" /> Já existe lead com este e-mail ou telefone</p>
      <ul className="space-y-1 text-xs">
        {duplicates.map((d) => (
          <li key={d.id}>
            {d.visible ? (
              <Link to="/leads/$leadId" params={{ leadId: d.id }} target="_blank" className="underline">{d.name}</Link>
            ) : (
              d.name
            )}
            {d.visible && d.company ? ` · ${d.company}` : ''}
          </li>
        ))}
      </ul>
    </div>
  )
}
