import { Briefcase } from 'lucide-react'
import * as React from 'react'
import { toCents } from '#/lib/pipeline'
import { convertLead } from '#/server/pipeline'
import { getTeamPipelines } from '#/server/pipelines'
import { Modal } from '../Modal'

type PipelineOption = { id: string; name: string }
type Props = { lead: { id: string; name: string; teamId: string }; onDone: (opportunityId: string) => void }

/** Botão + modal: cria a oportunidade na primeira etapa aberta do pipeline escolhido e marca o lead como qualificado. A escolha só aparece quando a equipe do lead tem mais de um pipeline. */
export function ConvertLeadModal({ lead, onDone }: Props) {
  const [open, setOpen] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [pipelines, setPipelines] = React.useState<Array<PipelineOption>>([])

  React.useEffect(() => {
    if (!open) return
    let current = true
    getTeamPipelines({ data: { teamId: lead.teamId } })
      .then((options) => current && setPipelines(options))
      .catch((e) => current && setError(e instanceof Error ? e.message : 'Erro ao carregar os pipelines'))
    return () => {
      current = false
    }
  }, [open, lead.teamId])

  async function submit(form: HTMLFormElement) {
    const f = new FormData(form)
    setBusy(true)
    try {
      const { id } = await convertLead({
        data: {
          leadId: lead.id,
          title: String(f.get('title')),
          amountCents: toCents(Number(f.get('amount') || 0)),
          expectedCloseDate: String(f.get('expectedCloseDate')) || null,
          pipelineId: String(f.get('pipelineId') ?? '') || undefined,
        },
      })
      setOpen(false)
      setError(null)
      onDone(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao converter')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-primary px-3 py-2 text-xs">
        <Briefcase className="h-4 w-4" /> Converter em oportunidade
      </button>
      <Modal open={open} onClose={() => setOpen(false)}>
        {open && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              submit(e.currentTarget)
            }}
            className="space-y-4 rounded-3xl border border-neutral-800 bg-neutral-950 p-6"
          >
            <h2 className="text-lg font-bold">Converter {lead.name}</h2>
            {pipelines.length > 1 && (
              <div className="space-y-1">
                <label htmlFor="pipelineId">Pipeline</label>
                <select id="pipelineId" name="pipelineId" defaultValue={pipelines[0]!.id}>
                  {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <p className="text-xs text-neutral-500">A oportunidade não muda de pipeline depois de criada.</p>
              </div>
            )}
            <div className="space-y-1">
              <label htmlFor="title">Título da oportunidade</label>
              <input id="title" name="title" required minLength={2} maxLength={200} defaultValue={`Negócio com ${lead.name}`} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label htmlFor="amount">Valor (R$)</label>
                <input id="amount" name="amount" type="number" min={0} step="0.01" defaultValue={0} />
              </div>
              <div className="space-y-1">
                <label htmlFor="expectedCloseDate">Previsão de fechamento</label>
                <input id="expectedCloseDate" name="expectedCloseDate" type="date" />
              </div>
            </div>
            {error && <p className="text-sm text-rose-400">{error}</p>}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancelar</button>
              <button className="btn-primary" disabled={busy}>Converter</button>
            </div>
          </form>
        )}
      </Modal>
    </>
  )
}
