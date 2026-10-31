import type { FormEvent } from 'react'

type Props = { team: { name: string; description: string | null }; onSave: (fields: { name: string; description: string }) => void }

export function EditTeamForm({ team, onSave }: Props) {
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    onSave({ name: String(f.get('name')), description: String(f.get('description')) })
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-3">
      <div className="space-y-1">
        <label htmlFor="team-name">Nome da equipe</label>
        <input id="team-name" name="name" required minLength={2} maxLength={100} defaultValue={team.name} />
      </div>
      <div className="space-y-1">
        <label htmlFor="team-description">Descrição</label>
        <textarea id="team-description" name="description" rows={2} maxLength={300} defaultValue={team.description ?? ''} />
      </div>
      <button className="btn-primary">Salvar</button>
    </form>
  )
}
