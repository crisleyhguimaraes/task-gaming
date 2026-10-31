import { Plus } from 'lucide-react'
import type { Act } from '#/components/useAttempt'
import { teamsWhereCan } from '#/components/users/model'
import { createBoard } from '#/server/boards'
import type { AuthCtx } from '#/server/roles'
import { isAdmin } from '#/server/roles'
import type { TeamRef } from './model'
import { TeamCheckboxes } from './TeamCheckboxes'

type Props = { me: AuthCtx; teams: ReadonlyArray<TeamRef>; act: Act }

/** O servidor exige `team.link` em cada equipe vinculada na criação; sem nenhuma, só o admin cria (board sem vínculo). */
export function NewBoardForm({ me, teams, act }: Props) {
  const linkable = teamsWhereCan(me, teams, 'team.link')
  const admin = isAdmin(me)

  if (!admin && linkable.length === 0) {
    return <p className="card text-sm text-neutral-400">Para criar um board você precisa poder vincular boards a uma das suas equipes. Peça a um admin.</p>
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        const form = e.currentTarget
        const f = new FormData(form)
        act(() => createBoard({ data: { name: String(f.get('name')), teamIds: f.getAll('teamIds').map(String) } }).then(() => form.reset()))
      }}
      className="card space-y-3"
    >
      <div className="space-y-1">
        <label htmlFor="new-board">Novo board</label>
        <input id="new-board" name="name" required minLength={2} maxLength={80} />
      </div>
      <TeamCheckboxes
        legend="Equipes"
        hint={admin ? 'Sem equipe, só o admin enxerga o board.' : 'Escolha ao menos uma equipe em que você pode vincular boards.'}
        teams={linkable}
        selected={[]}
      />
      <button className="btn-primary"><Plus className="h-4 w-4" /> Criar</button>
    </form>
  )
}
