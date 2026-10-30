import * as React from 'react'
import { Modal } from '../Modal'

const MIN_REASON_LENGTH = 3
const MAX_REASON_LENGTH = 500

type Props = { title: string | null; onConfirm: (reason: string) => void; onCancel: () => void }

/** `title` nulo = fechado. */
export function LostReasonModal({ title, onConfirm, onCancel }: Props) {
  return (
    <Modal open={title !== null} onClose={onCancel}>
      {title !== null && <LostReasonForm title={title} onConfirm={onConfirm} onCancel={onCancel} />}
    </Modal>
  )
}

function LostReasonForm({ title, onConfirm, onCancel }: { title: string } & Pick<Props, 'onConfirm' | 'onCancel'>) {
  const [reason, setReason] = React.useState('')
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onConfirm(reason.trim())
      }}
      className="space-y-4 rounded-3xl border border-neutral-800 bg-neutral-950 p-6"
    >
      <h2 className="text-lg font-bold">Por que perdeu?</h2>
      <p className="text-sm text-neutral-400">
        Registre o motivo de <b className="text-neutral-200">{title}</b> ter sido perdida.
      </p>
      <div className="space-y-1">
        <label htmlFor="lostReason">Motivo da perda</label>
        <textarea id="lostReason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={MAX_REASON_LENGTH} autoFocus />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onCancel} className="btn-ghost">Cancelar</button>
        <button className="btn-white" disabled={reason.trim().length < MIN_REASON_LENGTH}>Marcar como perdida</button>
      </div>
    </form>
  )
}
