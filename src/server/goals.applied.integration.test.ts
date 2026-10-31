import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { tasks } from '#/db/schema'
import { createGoalFor, effectiveGoalsOf, setGoalTeamsFor, updateGoalFor } from './goals.core'
import type { AuthCtx } from './roles'
import { goalOfDay, streak, tenantSettings } from './stats'
import { addAdmin, addTeam, addUser, joinTeam, makeTenant } from './test-fixtures'

type Fixture = Awaited<ReturnType<typeof makeTenant>>

const TZ = 'America/Sao_Paulo'
const SATURDAY = '2026-10-31'
const SUNDAY = '2026-11-01'
const MONDAY = '2026-11-02'
const TUESDAY = '2026-11-03'
const WEDNESDAY = '2026-11-04'
const THURSDAY = '2026-11-05'
const FRIDAY = '2026-11-06'
const LAST_FRIDAY = '2026-10-30'
const LAST_THURSDAY = '2026-10-29'
const WEEKDAYS = [1, 2, 3, 4, 5]
const WEEKEND = [0, 6]
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6]

let f: Fixture
let admin: AuthCtx
let sequence = 0

async function teamWithGoal(targetPoints: number, activeDays: Array<number>) {
  const team = await addTeam(f)
  const goal = await createGoalFor(admin, { name: `Meta ${++sequence}`, targetPoints, activeDays })
  await setGoalTeamsFor(admin, goal.id, [team.id])
  return { ...team, goal }
}

const memberOf = (team: { id: string }) => addUser(f, { role: 'MEMBER', team })

async function finishOn(userId: string, day: string) {
  await db.insert(tasks).values({
    tenantId: f.tenant.id,
    teamId: f.team.id,
    assignedToId: userId,
    title: 'Feita',
    basePoints: 10,
    estimatedSeconds: 600,
    status: 'finished',
    awardedPoints: 10,
    finishedAt: new Date(`${day}T15:00:00Z`),
  })
}

beforeAll(async () => {
  f = await makeTenant(0)
  admin = await addAdmin(f)
})
afterAll(async () => {
  await f.cleanup()
  await db.$client.end()
})

describe('configurações do tenant', () => {
  it('entregam só o fuso: a meta não vem mais do tenant', async () => {
    expect(await tenantSettings(f.tenant.id)).toEqual({ timezone: TZ })
  })
})

describe('meta do dia', () => {
  it('equipe sem meta própria vale a padrão: 100 pontos em dia útil e dia livre no fim de semana', async () => {
    const person = await memberOf(f.team)

    expect(await goalOfDay(person.userId, MONDAY)).toBe(100)
    expect(await goalOfDay(person.userId, FRIDAY)).toBe(100)
    expect(await goalOfDay(person.userId, SATURDAY)).toBeNull()
    expect(await goalOfDay(person.userId, SUNDAY)).toBeNull()
  })

  it('pessoa sem equipe vale a padrão', async () => {
    const loner = await addUser(f, { role: 'MEMBER', team: null })

    expect(await goalOfDay(loner.userId, MONDAY)).toBe(100)
    expect(await goalOfDay(loner.userId, SATURDAY)).toBeNull()
  })

  it('a meta da equipe vale no lugar da padrão, e os dias dela definem o que é dia livre', async () => {
    const person = await memberOf(await teamWithGoal(250, [2, 4]))

    expect(await goalOfDay(person.userId, TUESDAY)).toBe(250)
    expect(await goalOfDay(person.userId, MONDAY)).toBeNull()
    expect(await goalOfDay(person.userId, SATURDAY)).toBeNull()
  })

  it('pessoa em duas equipes cumpre a maior meta entre as que têm o dia ativo', async () => {
    const light = await teamWithGoal(150, [1, 2, 3])
    const heavy = await teamWithGoal(300, [3, 4, 5])
    const person = await joinTeam(f, (await memberOf(light)).userId, heavy)

    expect(await goalOfDay(person.userId, MONDAY)).toBe(150)
    expect(await goalOfDay(person.userId, WEDNESDAY)).toBe(300)
    expect(await goalOfDay(person.userId, FRIDAY)).toBe(300)
    expect(await goalOfDay(person.userId, SATURDAY)).toBeNull()
  })

  it('a equipe sem meta própria entra com a padrão ao lado da outra', async () => {
    const own = await teamWithGoal(150, [1, 2, 3])
    const person = await joinTeam(f, (await memberOf(own)).userId, f.team)

    expect(await goalOfDay(person.userId, MONDAY)).toBe(150)
    expect(await goalOfDay(person.userId, THURSDAY)).toBe(100)
  })

  it('effectiveGoalsOf devolve uma meta por vínculo', async () => {
    const own = await teamWithGoal(150, [1])
    const person = await joinTeam(f, (await memberOf(own)).userId, f.team)

    const rules = await effectiveGoalsOf(db, person.userId)

    expect(rules.map((r) => r.targetPoints).sort()).toEqual([100, 150])
  })
})

describe('sequência com os dias ativos das metas', () => {
  const sequenceOnMonday = (userId: string) => streak(userId, TZ, MONDAY)

  it('no padrão, o fim de semana sem tarefa não quebra a sequência', async () => {
    const person = await memberOf(f.team)
    await finishOn(person.userId, LAST_THURSDAY)
    await finishOn(person.userId, LAST_FRIDAY)

    expect(await sequenceOnMonday(person.userId)).toBe(2)
  })

  it('numa equipe que trabalha todo dia, o fim de semana sem tarefa quebra', async () => {
    const person = await memberOf(await teamWithGoal(100, EVERY_DAY))
    await finishOn(person.userId, LAST_THURSDAY)
    await finishOn(person.userId, LAST_FRIDAY)

    expect(await sequenceOnMonday(person.userId)).toBe(0)
  })

  it('usa a união dos dias das equipes: a segunda equipe com o fim de semana ativo passa a cobrá-lo', async () => {
    const weekend = await teamWithGoal(100, WEEKEND)
    const person = await joinTeam(f, (await memberOf(f.team)).userId, weekend)
    await finishOn(person.userId, LAST_THURSDAY)
    await finishOn(person.userId, LAST_FRIDAY)
    expect(await sequenceOnMonday(person.userId)).toBe(0)

    await finishOn(person.userId, SATURDAY)
    await finishOn(person.userId, SUNDAY)
    expect(await sequenceOnMonday(person.userId)).toBe(4)
  })

  it('mudar os dias da meta reescreve a sequência já existente', async () => {
    const team = await teamWithGoal(100, WEEKDAYS)
    const person = await memberOf(team)
    await finishOn(person.userId, LAST_THURSDAY)
    await finishOn(person.userId, LAST_FRIDAY)
    expect(await sequenceOnMonday(person.userId)).toBe(2)

    await updateGoalFor(admin, team.goal.id, { name: team.goal.name, targetPoints: 100, activeDays: EVERY_DAY })

    expect(await sequenceOnMonday(person.userId)).toBe(0)
  })
})
