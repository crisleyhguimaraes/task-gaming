import type { LeadStatus } from '#/db/schema'
import { leadSourceLabels, leadSources, leadStatuses, parseSource } from '#/lib/leads'

type LeadValues = { name: string; company: string | null; email: string | null; phone: string | null; source: string }

export function LeadFields({ lead }: { lead?: LeadValues }) {
  return (
    <>
      <div className="space-y-1 sm:col-span-2">
        <label htmlFor="name">Nome</label>
        <input id="name" name="name" required maxLength={160} defaultValue={lead?.name} />
      </div>
      <div className="space-y-1">
        <label htmlFor="company">Empresa</label>
        <input id="company" name="company" maxLength={160} defaultValue={lead?.company ?? ''} />
      </div>
      <div className="space-y-1">
        <label htmlFor="source">Origem</label>
        <select id="source" name="source" defaultValue={lead?.source ?? 'outro'}>
          {leadSources.map((s) => <option key={s} value={s}>{leadSourceLabels[s]}</option>)}
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor="email">E-mail</label>
        <input id="email" name="email" type="email" maxLength={200} defaultValue={lead?.email ?? ''} />
      </div>
      <div className="space-y-1">
        <label htmlFor="phone">Telefone</label>
        <input id="phone" name="phone" type="tel" maxLength={40} defaultValue={lead?.phone ?? ''} />
      </div>
    </>
  )
}

export function readLeadFields(form: FormData) {
  const text = (key: string) => String(form.get(key) ?? '')
  return {
    name: text('name'),
    company: text('company'),
    email: text('email'),
    phone: text('phone'),
    source: parseSource(text('source')),
  }
}

export function readLeadStatus(form: FormData): LeadStatus {
  return leadStatuses.find((s) => s === form.get('status')) ?? 'new'
}
