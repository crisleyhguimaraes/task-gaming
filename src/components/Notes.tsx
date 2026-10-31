import { useRouter } from '@tanstack/react-router'
import { Send } from 'lucide-react'
import * as React from 'react'
import { messageOf } from '#/components/useAttempt'
import { addNote } from '#/server/notes'
import type { NoteTarget } from '#/server/notes.core'

type NoteView = { id: string; body: string; createdAt: Date | string; authorName: string | null }

export function Notes({ target, notes }: { target: NoteTarget; notes: Array<NoteView> }) {
  const router = useRouter()
  const [error, setError] = React.useState<string | null>(null)

  async function submit(form: HTMLFormElement) {
    try {
      await addNote({ data: { target, body: String(new FormData(form).get('body')) } })
      form.reset()
      setError(null)
      router.invalidate()
    } catch (e) {
      setError(messageOf(e))
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-neutral-300">Notas</h2>
      <ul className="space-y-2">
        {notes.map((n) => (
          <li key={n.id} className="rounded-xl border border-neutral-800 px-3 py-2">
            <div className="text-xs text-neutral-500">
              {n.authorName ?? 'Usuário removido'} · {new Date(n.createdAt).toLocaleString('pt-BR')}
            </div>
            <p className="whitespace-pre-wrap text-sm">{n.body}</p>
          </li>
        ))}
        {notes.length === 0 && <li className="text-sm text-neutral-500">Nenhuma nota ainda.</li>}
      </ul>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit(e.currentTarget)
        }}
        className="flex items-end gap-2"
      >
        <textarea name="body" rows={2} maxLength={2000} required aria-label="Nova nota" placeholder="Escreva uma nota" />
        <button className="btn-primary" aria-label="Enviar nota"><Send className="h-4 w-4" /></button>
      </form>
      {error && <p className="text-sm text-rose-400">{error}</p>}
    </section>
  )
}
