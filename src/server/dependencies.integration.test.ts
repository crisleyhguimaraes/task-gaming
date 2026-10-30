import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { tasks, teams } from '#/db/schema'
import { addDependencyFor, getDependenciesFor } from './dependencies.core'
import { makeTenant } from './test-fixtures'

let f: Awaited<ReturnType<typeof makeTenant>>
let otherTeamId: string

const newTask = async (teamId: string, title: string) => {
  const [t] = await db
    .insert(tasks)
    .values({ tenantId: f.tenant.id, teamId, createdById: f.leader.userId, title, basePoints: 10, estimatedSeconds: 600 })
    .returning()
  return t!
}

beforeAll(async () => {
  f = await makeTenant(1)
  const [t] = await db.insert(teams).values({ tenantId: f.tenant.id, name: 'Outra equipe' }).returning()
  otherTeamId = t!.id
})
afterAll(async () => {
  await f.cleanup()
  await db.$client.end()
})

describe('addDependencyFor', () => {
  it('liga duas tarefas da mesma equipe', async () => {
    const a = await newTask(f.team.id, 'A')
    const b = await newTask(f.team.id, 'B')

    await addDependencyFor(f.leader, { taskId: a.id, dependsOnTaskId: b.id })

    const { deps } = await getDependenciesFor(f.leader, a.id)
    expect(deps.map((d) => d.id)).toEqual([b.id])
  })

  it('recusa dependência de tarefa de outra equipe', async () => {
    const mineTask = await newTask(f.team.id, 'Minha')
    const foreign = await newTask(otherTeamId, 'De outra equipe')

    await expect(addDependencyFor(f.leader, { taskId: mineTask.id, dependsOnTaskId: foreign.id })).rejects.toThrow('mesma equipe')
  })
})

describe('getDependenciesFor', () => {
  it('não mostra tarefa de outra equipe a quem não pode vê-la', async () => {
    const foreign = await newTask(otherTeamId, 'Sigilosa')

    await expect(getDependenciesFor(f.members[0]!, foreign.id)).rejects.toThrow('Tarefa não encontrada')
  })

  it('mostra tarefa da própria equipe', async () => {
    const own = await newTask(f.team.id, 'Da equipe')

    await expect(getDependenciesFor(f.members[0]!, own.id)).resolves.toMatchObject({ deps: [] })
  })
})
