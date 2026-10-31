import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { taskTimeLogs, tasks } from '#/db/schema'
import { createChallengeFor } from './challenges.core'
import type { AuthCtx } from './roles'
import { FACTORY_RULES } from './scoring'
import type { ScoringRules } from './scoring'
import { createScoringRuleFor, setScoringRuleTeamsFor, updateScoringRuleFor } from './scoring-rules.core'
import { activeTaskFor, attemptChallengeFor, finishTaskFor, pauseTaskFor, startTaskFor } from './tasks.core'
import { addAdmin, addTeam, addUser, joinTeam, makeTenant } from './test-fixtures'

type Fixture = Awaited<ReturnType<typeof makeTenant>>

let f: Fixture
let admin: AuthCtx

const min = (n: number) => n * 60
const at = (base: Date, minutes: number) => new Date(base.getTime() + min(minutes) * 1000)

let sequence = 0
const BONUS_50 = { paceBonusPct: 50 }
const TIGHT_CAP = { capMultiplier: 1, capMinMinutes: 1 }

async function ruleForTeam(teamId: string, patch: Partial<ScoringRules>) {
  const rule = await createScoringRuleFor(admin, { name: `Regra ${++sequence}`, rules: { ...FACTORY_RULES, ...patch } })
  await setScoringRuleTeamsFor(admin, rule.id, [teamId])
  return rule
}

const editRule = (rule: { id: string; name: string }, patch: Partial<ScoringRules>) =>
  updateScoringRuleFor(admin, rule.id, { name: rule.name, rules: { ...FACTORY_RULES, ...patch } })

const memberOf = (team: { id: string }) => addUser(f, { role: 'MEMBER', team })

async function newTask(teamId: string, patch: Partial<typeof tasks.$inferInsert> = {}) {
  const [task] = await db
    .insert(tasks)
    .values({ tenantId: f.tenant.id, teamId, createdById: f.leader.userId, title: 'T', basePoints: 100, estimatedSeconds: min(10), ...patch })
    .returning()
  return task!
}

const reload = async (taskId: string) => (await db.select().from(tasks).where(eq(tasks.id, taskId)))[0]!
const logsOf = (taskId: string) => db.select().from(taskTimeLogs).where(eq(taskTimeLogs.taskId, taskId))

beforeAll(async () => {
  f = await makeTenant(0)
  admin = await addAdmin(f)
})
afterAll(async () => {
  await f.cleanup()
  await db.$client.end()
})

describe('o snapshot da pontuação no primeiro start', () => {
  it('grava os parâmetros da regra vinculada à equipe da tarefa, com o id e o nome dela', async () => {
    const team = await addTeam(f)
    const rule = await ruleForTeam(team.id, BONUS_50)
    const task = await newTask(team.id)

    await startTaskFor(await memberOf(team), task.id)

    expect((await reload(task.id)).scoringSnapshot).toEqual({ ...FACTORY_RULES, ...BONUS_50, ruleId: rule.id, ruleName: rule.name })
  })

  it('equipe sem vínculo usa a regra padrão do tenant', async () => {
    const task = await newTask(f.team.id)

    await startTaskFor(await memberOf(f.team), task.id)

    expect((await reload(task.id)).scoringSnapshot).toEqual({ ...FACTORY_RULES, ruleId: f.scoringRule.id, ruleName: f.scoringRule.name })
  })

  it('tarefa ainda não iniciada não tem snapshot', async () => {
    expect((await newTask(f.team.id)).scoringSnapshot).toBeNull()
  })

  it('retomar não regrava: nem a troca de regra da equipe nem a edição da regra alcançam a tarefa já iniciada', async () => {
    const team = await addTeam(f)
    const first = await ruleForTeam(team.id, BONUS_50)
    const owner = await memberOf(team)
    const task = await newTask(team.id)
    const t0 = new Date()
    await startTaskFor(owner, task.id, t0)
    const snapshot = (await reload(task.id)).scoringSnapshot
    await pauseTaskFor(owner, task.id, at(t0, 1))
    await editRule(first, { paceBonusPct: 5 })
    await ruleForTeam(team.id, { paceBonusPct: 1 })

    await startTaskFor(owner, task.id, at(t0, 2))

    expect((await reload(task.id)).scoringSnapshot).toEqual(snapshot)
    expect(snapshot).toMatchObject({ ruleId: first.id, paceBonusPct: 50 })
  })
})

describe('pontuar com o snapshot', () => {
  it('editar a regra no meio da tarefa não muda a pontuação dela, mas vale para a próxima', async () => {
    const team = await addTeam(f)
    const rule = await ruleForTeam(team.id, BONUS_50)
    const owner = await memberOf(team)
    const [running, next] = [await newTask(team.id), await newTask(team.id)]
    const t0 = new Date()
    await startTaskFor(owner, running.id, t0)

    await editRule(rule, { paceBonusPct: 0 })
    const summary = await finishTaskFor(owner, running.id, at(t0, 5))
    await startTaskFor(owner, next.id, at(t0, 6))
    const later = await finishTaskFor(owner, next.id, at(t0, 11))

    expect(summary).toMatchObject({ paceBonus: 50, finalPoints: 150 })
    expect(later).toMatchObject({ paceBonus: 0, finalPoints: 100 })
  })

  it('o teto de abandono vem do snapshot ao fechar o bloco, e não da regra de fábrica nem da editada depois', async () => {
    const team = await addTeam(f)
    const rule = await ruleForTeam(team.id, TIGHT_CAP)
    const owner = await memberOf(team)
    const task = await newTask(team.id)
    const t0 = new Date()
    await startTaskFor(owner, task.id, t0)
    await editRule(rule, { capMultiplier: 9, capMinMinutes: 600 })

    await pauseTaskFor(owner, task.id, at(t0, 25))

    expect((await logsOf(task.id))[0]!.durationSeconds).toBe(min(10))
  })

  it('iniciar outra tarefa fecha o bloco da anterior com o teto da regra dela', async () => {
    const [capped, loose] = [await addTeam(f), await addTeam(f)]
    await ruleForTeam(capped.id, TIGHT_CAP)
    const owner = await joinTeam(f, (await memberOf(capped)).userId, loose)
    const [cappedTask, looseTask] = [await newTask(capped.id), await newTask(loose.id)]
    const t0 = new Date()
    await startTaskFor(owner, cappedTask.id, t0)

    await startTaskFor(owner, looseTask.id, at(t0, 25))

    expect((await logsOf(cappedTask.id))[0]!.durationSeconds).toBe(min(10))
    await pauseTaskFor(owner, looseTask.id, at(t0, 26))
  })

  it('o teto também vale ao concluir: o bloco aberto é fechado com o teto do snapshot', async () => {
    const team = await addTeam(f)
    await ruleForTeam(team.id, TIGHT_CAP)
    const owner = await memberOf(team)
    const task = await newTask(team.id)
    const t0 = new Date()
    await startTaskFor(owner, task.id, t0)

    const summary = await finishTaskFor(owner, task.id, at(t0, 25))

    expect(summary.movingSeconds).toBe(min(10))
  })

  it('o teto que o player exibe é o do snapshot', async () => {
    const team = await addTeam(f)
    await ruleForTeam(team.id, TIGHT_CAP)
    const owner = await memberOf(team)
    const task = await newTask(team.id)
    await startTaskFor(owner, task.id)

    expect((await activeTaskFor(owner))?.cap).toBe(min(10))
  })

  it('tarefa anterior às regras, sem snapshot, usa a regra de fábrica mesmo na equipe com regra própria, e retomá-la não cria snapshot', async () => {
    const team = await addTeam(f)
    await ruleForTeam(team.id, BONUS_50)
    const owner = await memberOf(team)
    const t0 = new Date()
    const legacy = await newTask(team.id, { status: 'paused', assignedToId: owner.userId, startedAt: t0 })

    await startTaskFor(owner, legacy.id, at(t0, 1))
    const summary = await finishTaskFor(owner, legacy.id, at(t0, 6))

    expect((await reload(legacy.id)).scoringSnapshot).toBeNull()
    expect(summary).toMatchObject({ paceBonus: 15, finalPoints: 115 })
  })
})

describe('tentativa de desafio', () => {
  it('usa a regra da equipe dona do desafio, não a das outras equipes de quem tenta', async () => {
    const [owning, mine] = [await addTeam(f), await addTeam(f)]
    const ownersRule = await ruleForTeam(owning.id, BONUS_50)
    await ruleForTeam(mine.id, { paceBonusPct: 1 })
    const challenge = await createChallengeFor(admin, { title: 'Cronometrado', basePoints: 100, estimatedMinutes: 10, scoredAttemptsPerDay: 1, teamId: owning.id })
    const both = await joinTeam(f, (await memberOf(owning)).userId, mine)

    const attempt = await attemptChallengeFor(both, challenge.id)

    expect((await reload(attempt.id)).scoringSnapshot).toMatchObject({ ruleId: ownersRule.id, paceBonusPct: 50 })
  })
})
