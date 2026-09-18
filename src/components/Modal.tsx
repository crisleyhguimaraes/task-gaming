import * as React from 'react'

/** <dialog> nativo controlado: showModal() prende o foco e Esc dispara onClose. */
export function Modal({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  const ref = React.useRef<HTMLDialogElement>(null)
  React.useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog ref={ref} onClose={onClose} className="m-auto w-[calc(100vw-2rem)] max-w-md">
      {open && children}
    </dialog>
  )
}
