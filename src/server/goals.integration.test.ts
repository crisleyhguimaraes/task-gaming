import { and, asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { auditEvents, goals, teams } from '#/db/schema'
import { createGoalFor, deleteGoalFor, listGoalsFor, setGoalTeamsFor, updateGoalFor } from './goals.core'
import type { AuthCtx } from './roles'
import { addAdmin, addTeam, addUser, makeTenant } from './test-fixtures'

type Fixture = Awaited<ReturnType<typeof makeTenant>>

let f: Fixture
let other: Fixture
let admin: AuthCtx
let otherAdmin: AuthCtx
let teamB: { id: string }

let sequence = 0
const uniqueName = (label: string) => `${label} ${++sequence}`
const weekdays = () => ({ name: uniqueName('Meta'), targetPoints: 200, activeDays: [1, 2, 3, 4, 5] })

const reload = async (id: string) => (await db.select().from(goals).where(eq(goals.id, id)))[0]
const goalOfTeam = async (teamId: string) => (await db.select({ goalId: teams.goalId }).from(teams).where(eq(teams.id, teamId)))[0]!.goalId
const auditOf = (entityId: string) =>
  db.select().from(auditEvents).where(and(eq(auditEvents.tenantId, f.tenant.id), eq(auditEvents.entityId, entityId))).orderBy(asc(auditEvents.createdAt), asc(auditEvents.id))
const actionsOf = async (entityId: string) => (await auditOf(entityId)).map((e) => e.action)
const teamsDiff = (meta: unknown) => {
  const { added, removed } = meta as { added: string; removed: string }
  const ids = (text: string) => (text ? text.split(',') : [])
  return { added: ids(added), removed: ids(removed) }
}

beforeAll(async () => {
  f = await makeTenant(2)
  other = await makeTenant(0)
  admin = await addAdmin(f)
  otherAdmin = await addAdmin(other)
  teamB = await addTeam(f, 'Equipe B')
})
afterAll(async () => {
  await f.cleanup()
  await other.cleanup()
  await db.$client.end()
})

describe('createGoalFor', () => {
  it('cria fora do padrão, com os dias em ordem e sem espaços no nome, e audita', async () => {
    const created = await createGoalFor(admin, { name: '  Plantão  ', targetPoints: 300, activeDays: [6, 0, 3] })

    expect(created).toMatchObject({ name: 'Plantão', targetPoints: 300, activeDays: [0, 3, 6], isDefault: false, tenantId: f.tenant.id })
    const [event] = await auditOf(created.id)
    expect(event).toMatchObject({ action: 'goal.created', entityType: 'goal', actorId: admin.userId, meta: { name: 'Plantão', targetPoints: 300, activeDays: '0,3,6' } })
  })

  it('recusa nome curto ou longo demais', async () => {
    await expect(createGoalFor(admin, { ...weekdays(), name: ' a ' })).rejects.toThrow('O nome da meta')
    await expect(createGoalFor(admin, { ...weekdays(), name: 'x'.repeat(81) })).rejects.toThrow('O nome da meta')
  })

  it.each([9, 10_001, 50.5, Number.NaN])('recusa meta de %s pontos', async (targetPoints) => {
    await expect(createGoalFor(admin, { ...weekdays(), targetPoints })).rejects.toThrow('Meta deve ser um inteiro entre 10 e 10000')
  })

  it.each([[[]], [[7]], [[1, 1]], [[-1]]])('recusa os dias %j', async (activeDays) => {
    await expect(createGoalFor(admin, { ...weekdays(), activeDays })).rejects.toThrow('dia')
  })

  it('recusa nome repetido sem diferenciar maiúsculas nem espaços, mas aceita o mesmo nome em outro tenant', async () => {
    const name = uniqueName('Repetida')
    await createGoalFor(admin, { ...weekdays(), name })

    await expect(createGoalFor(admin, { ...weekdays(), name: `  ${name.toUpperCase()} ` })).rejects.toThrow('Já existe uma meta com esse nome')
    await expect(createGoalFor(otherAdmin, { ...weekdays(), name })).resolves.toMatchObject({ name })
  })
})

describe('capability goal.configure', () => {
  it('só admin configura; líder e membro são barrados em toda operação', async () => {
    const goal = await createGoalFor(admin, weekdays())
    for (const me of [f.leader, f.members[0]!]) {
      await expect(listGoalsFor(me)).rejects.toThrow('Sem permissão')
      await expect(createGoalFor(me, weekdays())).rejects.toThrow('Sem permissão')
      await expect(updateGoalFor(me, goal.id, weekdays())).rejects.toThrow('Sem permissão')
      await expect(deleteGoalFor(me, goal.id)).rejects.toThrow('Sem permissão')
      await expect(setGoalTeamsFor(me, goal.id, [f.team.id])).rejects.toThrow('Sem permissão')
    }
  })

  it('não é delegável: o override gravado para o líder é ignorado', async () => {
    const delegated: AuthCtx = { ...f.leader, capabilityOverrides: { LEADER: { 'goal.configure': true } } }

    await expect(createGoalFor(delegated, weekdays())).rejects.toThrow('Sem permissão')
  })
})

describe('updateGoalFor', () => {
  it('altera nome, meta e dias, e audita o antes e o depois só do que mudou, com os dias como texto', async () => {
    const goal = await createGoalFor(admin, { name: uniqueName('Editável'), targetPoints: 200, activeDays: [1, 2, 3] })

    const updated = await updateGoalFor(admin, goal.id, { name: goal.name, targetPoints: 250, activeDays: [3, 2, 1, 4] })

    expect(updated).toMatchObject({ targetPoints: 250, activeDays: [1, 2, 3, 4] })
    const events = await auditOf(goal.id)
    expect(events.at(-1)).toMatchObject({
      action: 'goal.updated',
      changes: { targetPoints: { from: 200, to: 250 }, activeDays: { from: '1,2,3', to: '1,2,3,4' } },
    })
    expect(Object.keys(events.at(-1)!.changes!).sort()).toEqual(['activeDays', 'targetPoints'])
  })

  it('salvar sem mudar nada não gera evento', async () => {
    const goal = await createGoalFor(admin, weekdays())

    await updateGoalFor(admin, goal.id, { name: goal.name, targetPoints: goal.targetPoints, activeDays: [...goal.activeDays] })

    expect(await actionsOf(goal.id)).toEqual(['goal.created'])
  })

  it('valida no core: meta e dias inválidos não gravam nada', async () => {
    const goal = await createGoalFor(admin, weekdays())

    await expect(updateGoalFor(admin, goal.id, { name: goal.name, targetPoints: 5, activeDays: [1] })).rejects.toThrow('Meta deve ser um inteiro')
    await expect(updateGoalFor(admin, goal.id, { name: goal.name, targetPoints: 100, activeDays: [] })).rejects.toThrow('ao menos um dia')
    expect(await reload(goal.id)).toMatchObject({ targetPoints: goal.targetPoints })
  })

  it('recusa renomear para um nome que já existe', async () => {
    const [a, b] = [await createGoalFor(admin, weekdays()), await createGoalFor(admin, weekdays())]

    await expect(updateGoalFor(admin, b.id, { name: a.name.toUpperCase(), targetPoints: 100, activeDays: [1] })).rejects.toThrow('Já existe uma meta com esse nome')
  })

  it('o padrão pode ser ajustado e continua sendo o padrão', async () => {
    const updated = await updateGoalFor(admin, f.goal.id, { name: f.goal.name, targetPoints: 120, activeDays: [1, 2, 3, 4, 5] })

    expect(updated).toMatchObject({ isDefault: true, targetPoints: 120 })
    await updateGoalFor(admin, f.goal.id, { name: f.goal.name, targetPoints: 100, activeDays: [1, 2, 3, 4, 5] })
  })

  it('meta de outro tenant não existe', async () => {
    const foreign = await createGoalFor(otherAdmin, weekdays())

    await expect(updateGoalFor(admin, foreign.id, weekdays())).rejects.toThrow('Meta não encontrada')
    expect(await reload(foreign.id)).toMatchObject({ name: foreign.name })
  })
})

describe('deleteGoalFor', () => {
  it('o padrão não se exclui', async () => {
    await expect(deleteGoalFor(admin, f.goal.id)).rejects.toThrow('A meta padrão não pode ser excluída')
    expect(await reload(f.goal.id)).toBeDefined()
  })

  it('exclui e audita; as equipes vinculadas voltam ao padrão', async () => {
    const goal = await createGoalFor(admin, weekdays())
    const team = await addTeam(f)
    await setGoalTeamsFor(admin, goal.id, [team.id])

    await deleteGoalFor(admin, goal.id)

    expect(await reload(goal.id)).toBeUndefined()
    expect(await goalOfTeam(team.id)).toBeNull()
    expect((await auditOf(goal.id)).at(-1)).toMatchObject({ action: 'goal.deleted', meta: { name: goal.name, removed: team.id } })
  })

  it('meta de outro tenant não existe', async () => {
    const foreign = await createGoalFor(otherAdmin, weekdays())

    await expect(deleteGoalFor(admin, foreign.id)).rejects.toThrow('Meta não encontrada')
    expect(await reload(foreign.id)).toBeDefined()
  })
})

describe('setGoalTeamsFor', () => {
  it('define exatamente as equipes da meta e audita quem entrou e quem saiu', async () => {
    const [x, y, z] = [await addTeam(f), await addTeam(f), await addTeam(f)]
    const goal = await createGoalFor(admin, weekdays())

    await setGoalTeamsFor(admin, goal.id, [x.id, y.id])
    await setGoalTeamsFor(admin, goal.id, [y.id, z.id])

    expect([await goalOfTeam(x.id), await goalOfTeam(y.id), await goalOfTeam(z.id)]).toEqual([null, goal.id, goal.id])
    const [, first, second] = await auditOf(goal.id)
    expect(first).toMatchObject({ action: 'goal.teams_changed', entityType: 'goal', actorId: admin.userId, meta: { name: goal.name } })
    expect(teamsDiff(first!.meta)).toEqual({ added: [x.id, y.id].sort(), removed: [] })
    expect(teamsDiff(second!.meta)).toEqual({ added: [z.id], removed: [x.id] })
  })

  it('repetir as mesmas equipes não gera evento, e lista vazia solta todas', async () => {
    const team = await addTeam(f)
    const goal = await createGoalFor(admin, weekdays())
    await setGoalTeamsFor(admin, goal.id, [team.id])

    await setGoalTeamsFor(admin, goal.id, [team.id, team.id])
    expect(await actionsOf(goal.id)).toEqual(['goal.created', 'goal.teams_changed'])

    await setGoalTeamsFor(admin, goal.id, [])
    expect(await goalOfTeam(team.id)).toBeNull()
    expect(teamsDiff((await auditOf(goal.id)).at(-1)!.meta)).toEqual({ added: [], removed: [team.id] })
  })

  it('mover a equipe para outra meta tira da anterior', async () => {
    const team = await addTeam(f)
    const [first, second] = [await createGoalFor(admin, weekdays()), await createGoalFor(admin, weekdays())]
    await setGoalTeamsFor(admin, first.id, [team.id])

    await setGoalTeamsFor(admin, second.id, [team.id])

    expect(await goalOfTeam(team.id)).toBe(second.id)
    const list = await listGoalsFor(admin)
    expect(list.find((g) => g.id === first.id)!.teams).toEqual([])
  })

  it('recusa equipe de outro tenant e não altera nenhuma das outras', async () => {
    const goal = await createGoalFor(admin, weekdays())

    await expect(setGoalTeamsFor(admin, goal.id, [teamB.id, other.team.id])).rejects.toThrow('Equipe não encontrada')

    expect(await goalOfTeam(teamB.id)).toBeNull()
    expect(await goalOfTeam(other.team.id)).toBeNull()
    expect(await actionsOf(goal.id)).toEqual(['goal.created'])
  })

  it('recusa meta de outro tenant', async () => {
    const foreign = await createGoalFor(otherAdmin, weekdays())

    await expect(setGoalTeamsFor(admin, foreign.id, [teamB.id])).rejects.toThrow('Meta não encontrada')
  })

  it('o padrão vale para quem não tem meta própria: não se vincula equipe a ele', async () => {
    await expect(setGoalTeamsFor(admin, f.goal.id, [teamB.id])).rejects.toThrow('A meta padrão vale para as equipes sem meta própria')
  })

  it('dois admins ao mesmo tempo: o último vence, e os dois diffs fecham com o estado final', async () => {
    const [t1, t2, t3] = [await addTeam(f), await addTeam(f), await addTeam(f)]
    const secondAdmin = await addUser(f, { role: 'TENANT_ADMIN', team: null })
    const goal = await createGoalFor(admin, weekdays())
    await setGoalTeamsFor(admin, goal.id, [t1.id])
    const before = (await auditOf(goal.id)).length

    await Promise.all([setGoalTeamsFor(admin, goal.id, [t2.id]), setGoalTeamsFor(secondAdmin, goal.id, [t3.id])])

    const racing = (await auditOf(goal.id)).slice(before)
    const diffOf = (actorId: string) => teamsDiff(racing.find((e) => e.actorId === actorId)!.meta)
    const linked = (await db.select({ id: teams.id }).from(teams).where(eq(teams.goalId, goal.id))).map((t) => t.id)
    const adminFirst = { admin: { added: [t2.id], removed: [t1.id] }, second: { added: [t3.id], removed: [t2.id] }, final: [t3.id] }
    const secondFirst = { admin: { added: [t2.id], removed: [t3.id] }, second: { added: [t3.id], removed: [t1.id] }, final: [t2.id] }
    expect(racing).toHaveLength(2)
    expect([adminFirst, secondFirst]).toContainEqual({ admin: diffOf(admin.userId), second: diffOf(secondAdmin.userId), final: linked })
  })
})

describe('listGoalsFor', () => {
  it('traz o padrão primeiro, com as equipes que o usam por não terem meta própria, e as equipes de cada meta', async () => {
    const isolated = await makeTenant(0)
    try {
      const boss = await addAdmin(isolated)
      await addTeam(isolated, 'Solta')
      const linked = await addTeam(isolated, 'Vinculada')
      const own = await createGoalFor(boss, { name: 'A própria', targetPoints: 50, activeDays: [1] })
      await setGoalTeamsFor(boss, own.id, [linked.id])

      const list = await listGoalsFor(boss)

      expect(list.map((g) => g.name)).toEqual(['Padrão', 'A própria'])
      expect(list[0]).toMatchObject({ isDefault: true, targetPoints: 100, activeDays: [1, 2, 3, 4, 5] })
      expect(list[0]!.teams.map((t) => t.name)).toEqual(['Solta', 'Time'])
      expect(list[1]!.teams).toEqual([{ id: linked.id, name: 'Vinculada' }])
    } finally {
      await isolated.cleanup()
    }
  })

  it('não mostra metas nem equipes de outro tenant', async () => {
    const foreign = await createGoalFor(otherAdmin, weekdays())

    const list = await listGoalsFor(admin)

    expect(list.map((g) => g.id)).not.toContain(foreign.id)
    expect(list.flatMap((g) => g.teams.map((t) => t.id))).not.toContain(other.team.id)
  })
})
