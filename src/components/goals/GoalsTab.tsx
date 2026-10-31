import { useRouter } from '@tanstack/react-router'
import { MAX_GOAL_POINTS, MIN_GOAL_POINTS, BUSINESS_DAYS, validateGoal } from '#/lib/goals'
import { createGoal, deleteGoal, setGoalTeams, updateGoal } from '#/server/goals'
import type { listGoals } from '#/server/goals'
import * as React from 'react'
import { CatalogPanel } from './CatalogPanel'
import { allTeams, otherOwners, useAttempt } from './model'
import { TeamCheckboxes } from './TeamCheckboxes'
import { WeekdayChips, WeekdayPicker } from './WeekdayPicker'

type GoalItem = Awaited<ReturnType<typeof listGoals>>[number]

export function GoalsTab({ goals }: { goals: ReadonlyArray<GoalItem> }) {
  const router = useRouter()
  const teams = allTeams(goals)

  async function save(goal: GoalItem | null, input: { name: string; targetPoints: number; activeDays: Array<number> }, teamIds: Array<string>) {
    const goalId = goal?.id ?? (await createGoal({ data: input })).id
    if (goal) await updateGoal({ data: { goalId, ...input } })
    if (!goal?.isDefault) await setGoalTeams({ data: { goalId, teamIds } })
    await router.invalidate()
  }

  return (
    <CatalogPanel
      noun="meta"
      createLabel="Nova meta"
      items={goals}
      summary={(goal) => (
        <div className="space-y-1.5">
          <p className="text-sm text-neutral-300"><b className="text-neutral-50">{goal.targetPoints}</b> pts por dia</p>
          <WeekdayChips days={goal.activeDays} />
        </div>
      )}
      renderForm={(goal, close) => (
        <GoalForm key={goal?.id ?? 'new'} goal={goal} teams={teams} owners={otherOwners(goals, goal?.id ?? null)} onSave={(input, teamIds) => save(goal, input, teamIds)} onClose={close} />
      )}
      onDelete={async (goal) => {
        await deleteGoal({ data: { goalId: goal.id } })
        await router.invalidate()
      }}
    />
  )
}

type GoalFormProps = {
  goal: GoalItem | null
  teams: ReadonlyArray<{ id: string; name: string }>
  owners: ReadonlyMap<string, string>
  onSave: (input: { name: string; targetPoints: number; activeDays: Array<number> }, teamIds: Array<string>) => Promise<void>
  onClose: () => void
}

function GoalForm({ goal, teams, owners, onSave, onClose }: GoalFormProps) {
  const [days, setDays] = React.useState<Array<number>>(goal ? [...goal.activeDays] : [...BUSINESS_DAYS])
  const { error, setError, attempt } = useAttempt()
  const headingId = `goal-form-${goal?.id ?? 'new'}`

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const input = { name: String(f.get('name')), targetPoints: Number(f.get('targetPoints')), activeDays: days }
    const errors = validateGoal(input)
    if (errors.length) return setError(errors.join('; '))
    await attempt(async () => {
      await onSave(input, f.getAll('teamIds').map(String))
      onClose()
    })
  }

  return (
    <form onSubmit={submit} aria-labelledby={headingId} className="space-y-4">
      <h3 id={headingId} className="text-sm font-semibold">{goal ? `Editar ${goal.name}` : 'Nova meta'}</h3>
      <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
        <div className="space-y-1">
          <label htmlFor={`${headingId}-name`}>Nome</label>
          <input id={`${headingId}-name`} name="name" defaultValue={goal?.name ?? ''} required minLength={2} maxLength={80} />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${headingId}-points`}>Pontos por dia</label>
          <input id={`${headingId}-points`} name="targetPoints" type="number" inputMode="numeric" required min={MIN_GOAL_POINTS} max={MAX_GOAL_POINTS} step={1} defaultValue={goal?.targetPoints ?? 100} />
        </div>
      </div>
      <WeekdayPicker days={days} onChange={setDays} />
      {goal?.isDefault ? (
        <p className="text-xs text-neutral-500">A meta padrão vale para as equipes sem meta própria. Para tirar uma equipe dela, vincule a equipe a outra meta.</p>
      ) : (
        <TeamCheckboxes teams={teams} selected={goal?.teams ?? []} otherOwners={owners} noun="meta" />
      )}
      {error && <p role="alert" className="text-sm text-rose-400">{error}</p>}
      <div className="flex gap-2">
        <button className="btn-primary">Salvar</button>
        <button type="button" onClick={onClose} className="btn-ghost">Cancelar</button>
      </div>
    </form>
  )
}
