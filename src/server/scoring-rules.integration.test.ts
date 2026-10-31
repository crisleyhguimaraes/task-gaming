import { and, asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { auditEvents, scoringRules, teams } from '#/db/schema'
import type { AuthCtx } from './roles'
import { FACTORY_RULES } from './scoring'
import type { ScoringRules } from './scoring'
import { createScoringRuleFor, deleteScoringRuleFor, listScoringRulesFor, setScoringRuleTeamsFor, updateScoringRuleFor } from './scoring-rules.core'
import { addAdmin, addTeam, addUser, makeTenant } from './test-fixtures'

type Fixture = Awaited<ReturnType<typeof makeTenant>>

let f: Fixture
let other: Fixture
let admin: AuthCtx
let otherAdmin: AuthCtx
let teamB: { id: string }

let sequence = 0
const uniqueName = (label: string) => `${label} ${++sequence}`
const generous = (patch: Partial<ScoringRules> = {}): { name: string; rules: ScoringRules } => ({ name: uniqueName('Pontuação'), rules: { ...FACTORY_RULES, paceBonusPct: 25, ...patch } })

const reload = async (id: string) => (await db.select().from(scoringRules).where(eq(scoringRules.id, id)))[0]
const ruleOfTeam = async (teamId: string) => (await db.select({ ruleId: teams.scoringRuleId }).from(teams).where(eq(teams.id, teamId)))[0]!.ruleId
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

describe('createScoringRuleFor', () => {
  it('cria fora do padrão, com o nome aparado e todos os parâmetros, e audita', async () => {
    const created = await createScoringRuleFor(admin, { name: '  Generosa  ', rules: { ...FACTORY_RULES, paceBonusPct: 25, capMultiplier: 3 } })

    expect(created).toMatchObject({ name: 'Generosa', isDefault: false, tenantId: f.tenant.id, ...FACTORY_RULES, paceBonusPct: 25, capMultiplier: 3 })
    const [event] = await auditOf(created.id)
    expect(event).toMatchObject({ action: 'scoring_rule.created', entityType: 'scoring_rule', actorId: admin.userId, meta: { name: 'Generosa', paceBonusPct: 25, capMultiplier: 3 } })
  })

  it('recusa nome curto ou longo demais', async () => {
    await expect(createScoringRuleFor(admin, { ...generous(), name: ' a ' })).rejects.toThrow('O nome da pontuação')
    await expect(createScoringRuleFor(admin, { ...generous(), name: 'x'.repeat(81) })).rejects.toThrow('O nome da pontuação')
  })

  it.each([
    [{ validateBelowPct: 80 }, 'validação < ritmo < estouro'],
    [{ overtimeAbovePct: 80 }, 'validação < ritmo < estouro'],
    [{ floorPct: 0 }, 'O piso'],
    [{ floorPct: 101 }, 'O piso'],
    [{ overtimeStepPct: 0 }, 'O degrau'],
    [{ capMultiplier: 0 }, 'O multiplicador'],
    [{ capMinMinutes: 0 }, 'O teto mínimo'],
    [{ paceBonusPct: -1 }, 'não negativos'],
    [{ pausePenaltyPct: 1.5 }, 'inteiros'],
  ] satisfies Array<[Partial<ScoringRules>, string]>)('recusa os parâmetros %j', async (patch, message) => {
    await expect(createScoringRuleFor(admin, generous(patch))).rejects.toThrow(message)
  })

  it('recusa nome repetido sem diferenciar maiúsculas nem espaços, mas aceita o mesmo nome em outro tenant', async () => {
    const name = uniqueName('Repetida')
    await createScoringRuleFor(admin, { ...generous(), name })

    await expect(createScoringRuleFor(admin, { ...generous(), name: `  ${name.toUpperCase()} ` })).rejects.toThrow('Já existe uma pontuação com esse nome')
    await expect(createScoringRuleFor(otherAdmin, { ...generous(), name })).resolves.toMatchObject({ name })
  })
})

describe('capability scoring.configure', () => {
  it('só admin configura; líder e membro são barrados em toda operação', async () => {
    const rule = await createScoringRuleFor(admin, generous())
    for (const me of [f.leader, f.members[0]!]) {
      await expect(listScoringRulesFor(me)).rejects.toThrow('Sem permissão')
      await expect(createScoringRuleFor(me, generous())).rejects.toThrow('Sem permissão')
      await expect(updateScoringRuleFor(me, rule.id, generous())).rejects.toThrow('Sem permissão')
      await expect(deleteScoringRuleFor(me, rule.id)).rejects.toThrow('Sem permissão')
      await expect(setScoringRuleTeamsFor(me, rule.id, [f.team.id])).rejects.toThrow('Sem permissão')
    }
  })

  it('não é delegável: o override gravado para o líder é ignorado', async () => {
    const delegated: AuthCtx = { ...f.leader, capabilityOverrides: { LEADER: { 'scoring.configure': true } } }

    await expect(createScoringRuleFor(delegated, generous())).rejects.toThrow('Sem permissão')
  })
})

describe('updateScoringRuleFor', () => {
  it('audita o antes e o depois só do que mudou', async () => {
    const rule = await createScoringRuleFor(admin, generous())

    const updated = await updateScoringRuleFor(admin, rule.id, { name: rule.name, rules: { ...FACTORY_RULES, paceBonusPct: 30, floorPct: 60 } })

    expect(updated).toMatchObject({ paceBonusPct: 30, floorPct: 60 })
    const event = (await auditOf(rule.id)).at(-1)!
    expect(event).toMatchObject({ action: 'scoring_rule.updated', changes: { paceBonusPct: { from: 25, to: 30 }, floorPct: { from: 50, to: 60 } } })
    expect(Object.keys(event.changes!).sort()).toEqual(['floorPct', 'paceBonusPct'])
  })

  it('salvar sem mudar nada não gera evento', async () => {
    const rule = await createScoringRuleFor(admin, generous())

    await updateScoringRuleFor(admin, rule.id, { name: rule.name, rules: { ...FACTORY_RULES, paceBonusPct: 25 } })

    expect(await actionsOf(rule.id)).toEqual(['scoring_rule.created'])
  })

  it('valida no core: parâmetros inválidos não gravam nada', async () => {
    const rule = await createScoringRuleFor(admin, generous())

    await expect(updateScoringRuleFor(admin, rule.id, { name: rule.name, rules: { ...FACTORY_RULES, floorPct: 0 } })).rejects.toThrow('O piso')
    expect(await reload(rule.id)).toMatchObject({ floorPct: FACTORY_RULES.floorPct })
  })

  it('recusa renomear para um nome que já existe', async () => {
    const [a, b] = [await createScoringRuleFor(admin, generous()), await createScoringRuleFor(admin, generous())]

    await expect(updateScoringRuleFor(admin, b.id, { name: a.name.toUpperCase(), rules: FACTORY_RULES })).rejects.toThrow('Já existe uma pontuação com esse nome')
  })

  it('pontuação de outro tenant não existe', async () => {
    const foreign = await createScoringRuleFor(otherAdmin, generous())

    await expect(updateScoringRuleFor(admin, foreign.id, generous())).rejects.toThrow('Pontuação não encontrada')
  })
})

describe('deleteScoringRuleFor', () => {
  it('o padrão não se exclui', async () => {
    await expect(deleteScoringRuleFor(admin, f.scoringRule.id)).rejects.toThrow('A pontuação padrão não pode ser excluída')
    expect(await reload(f.scoringRule.id)).toBeDefined()
  })

  it('exclui e audita; as equipes vinculadas voltam ao padrão', async () => {
    const rule = await createScoringRuleFor(admin, generous())
    const team = await addTeam(f)
    await setScoringRuleTeamsFor(admin, rule.id, [team.id])

    await deleteScoringRuleFor(admin, rule.id)

    expect(await reload(rule.id)).toBeUndefined()
    expect(await ruleOfTeam(team.id)).toBeNull()
    expect((await auditOf(rule.id)).at(-1)).toMatchObject({ action: 'scoring_rule.deleted', meta: { name: rule.name, removed: team.id } })
  })

  it('pontuação de outro tenant não existe', async () => {
    const foreign = await createScoringRuleFor(otherAdmin, generous())

    await expect(deleteScoringRuleFor(admin, foreign.id)).rejects.toThrow('Pontuação não encontrada')
  })
})

describe('setScoringRuleTeamsFor', () => {
  it('define exatamente as equipes da pontuação e audita quem entrou e quem saiu', async () => {
    const [x, y, z] = [await addTeam(f), await addTeam(f), await addTeam(f)]
    const rule = await createScoringRuleFor(admin, generous())

    await setScoringRuleTeamsFor(admin, rule.id, [x.id, y.id])
    await setScoringRuleTeamsFor(admin, rule.id, [y.id, z.id])

    expect([await ruleOfTeam(x.id), await ruleOfTeam(y.id), await ruleOfTeam(z.id)]).toEqual([null, rule.id, rule.id])
    const [, first, second] = await auditOf(rule.id)
    expect(first).toMatchObject({ action: 'scoring_rule.teams_changed', entityType: 'scoring_rule', actorId: admin.userId })
    expect(teamsDiff(first!.meta)).toEqual({ added: [x.id, y.id].sort(), removed: [] })
    expect(teamsDiff(second!.meta)).toEqual({ added: [z.id], removed: [x.id] })
  })

  it('o vínculo de meta e o de pontuação são independentes', async () => {
    const team = await addTeam(f)
    const rule = await createScoringRuleFor(admin, generous())

    await setScoringRuleTeamsFor(admin, rule.id, [team.id])

    expect((await db.select().from(teams).where(eq(teams.id, team.id)))[0]).toMatchObject({ scoringRuleId: rule.id, goalId: null })
  })

  it('recusa equipe de outro tenant e não altera nenhuma das outras', async () => {
    const rule = await createScoringRuleFor(admin, generous())

    await expect(setScoringRuleTeamsFor(admin, rule.id, [teamB.id, other.team.id])).rejects.toThrow('Equipe não encontrada')

    expect(await ruleOfTeam(teamB.id)).toBeNull()
    expect(await actionsOf(rule.id)).toEqual(['scoring_rule.created'])
  })

  it('recusa pontuação de outro tenant e o padrão', async () => {
    const foreign = await createScoringRuleFor(otherAdmin, generous())

    await expect(setScoringRuleTeamsFor(admin, foreign.id, [teamB.id])).rejects.toThrow('Pontuação não encontrada')
    await expect(setScoringRuleTeamsFor(admin, f.scoringRule.id, [teamB.id])).rejects.toThrow('A pontuação padrão vale para as equipes sem pontuação própria')
  })

  it('dois admins ao mesmo tempo: o último vence, e os dois diffs fecham com o estado final', async () => {
    const [t1, t2, t3] = [await addTeam(f), await addTeam(f), await addTeam(f)]
    const secondAdmin = await addUser(f, { role: 'TENANT_ADMIN', team: null })
    const rule = await createScoringRuleFor(admin, generous())
    await setScoringRuleTeamsFor(admin, rule.id, [t1.id])
    const before = (await auditOf(rule.id)).length

    await Promise.all([setScoringRuleTeamsFor(admin, rule.id, [t2.id]), setScoringRuleTeamsFor(secondAdmin, rule.id, [t3.id])])

    const racing = (await auditOf(rule.id)).slice(before)
    const diffOf = (actorId: string) => teamsDiff(racing.find((e) => e.actorId === actorId)!.meta)
    const linked = (await db.select({ id: teams.id }).from(teams).where(eq(teams.scoringRuleId, rule.id))).map((t) => t.id)
    const adminFirst = { admin: { added: [t2.id], removed: [t1.id] }, second: { added: [t3.id], removed: [t2.id] }, final: [t3.id] }
    const secondFirst = { admin: { added: [t2.id], removed: [t3.id] }, second: { added: [t3.id], removed: [t1.id] }, final: [t2.id] }
    expect(racing).toHaveLength(2)
    expect([adminFirst, secondFirst]).toContainEqual({ admin: diffOf(admin.userId), second: diffOf(secondAdmin.userId), final: linked })
  })
})

describe('listScoringRulesFor', () => {
  it('traz o padrão primeiro, com as equipes sem pontuação própria, e as equipes de cada pontuação', async () => {
    const isolated = await makeTenant(0)
    try {
      const boss = await addAdmin(isolated)
      const loose = await addTeam(isolated, 'Solta')
      const linked = await addTeam(isolated, 'Vinculada')
      const own = await createScoringRuleFor(boss, { name: 'A própria', rules: FACTORY_RULES })
      await setScoringRuleTeamsFor(boss, own.id, [linked.id])

      const list = await listScoringRulesFor(boss)

      expect(list.map((r) => r.name)).toEqual(['Padrão', 'A própria'])
      expect(list[0]).toMatchObject({ isDefault: true, ...FACTORY_RULES })
      expect(list[0]!.teams.map((t) => t.id)).toEqual([loose.id, isolated.team.id])
      expect(list[1]!.teams).toEqual([{ id: linked.id, name: 'Vinculada' }])
    } finally {
      await isolated.cleanup()
    }
  })

  it('não mostra pontuações nem equipes de outro tenant', async () => {
    const foreign = await createScoringRuleFor(otherAdmin, generous())

    const list = await listScoringRulesFor(admin)

    expect(list.map((r) => r.id)).not.toContain(foreign.id)
    expect(list.flatMap((r) => r.teams.map((t) => t.id))).not.toContain(other.team.id)
  })
})
