import { and, asc, desc, eq } from 'drizzle-orm'
import { db } from '#/db'
import { scoringRules, teams } from '#/db/schema'
import { diffFields } from '#/lib/audit'
import { recordAudit } from './audit.core'
import { DEFAULT_ITEM_NAME, replaceTeamsOfItem, scoringRuleLink, teamsAuditMeta, teamsByItem } from './catalog.core'
import { failOnDuplicate } from './duplicate'
import type { AuthCtx } from './roles'
import { fail, requireCan } from './roles'
import type { ScoringRules, ScoringSnapshot } from './scoring'
import { FACTORY_RULES, validateRules } from './scoring'
import type { Reader, Tx } from './tx'
import { assertValidName } from './validation'

const RULE_FIELDS = Object.keys(FACTORY_RULES) as Array<keyof ScoringRules>
const DUPLICATE_NAME = 'Já existe uma pontuação com esse nome'

export type ScoringRuleInput = { name: string; rules: ScoringRules }

const pickRules = (source: ScoringRules) => Object.fromEntries(RULE_FIELDS.map((field) => [field, source[field]])) as ScoringRules

export async function insertDefaultScoringRule(tx: Pick<typeof db, 'insert'>, tenantId: string) {
  const [rule] = await tx.insert(scoringRules).values({ tenantId, name: DEFAULT_ITEM_NAME, isDefault: true, ...FACTORY_RULES }).returning()
  return rule!
}

/** A regra que pontua o trabalho da equipe: a vinculada ou, sem vínculo, a padrão do tenant. Falha se faltar o padrão, sem regra de reserva. */
export async function snapshotOfTeam(tx: Reader, tenantId: string, teamId: string): Promise<ScoringSnapshot> {
  const [team] = await tx.select({ scoringRuleId: teams.scoringRuleId }).from(teams).where(and(eq(teams.id, teamId), eq(teams.tenantId, tenantId)))
  const [rule] = await tx
    .select()
    .from(scoringRules)
    .where(and(eq(scoringRules.tenantId, tenantId), team?.scoringRuleId ? eq(scoringRules.id, team.scoringRuleId) : eq(scoringRules.isDefault, true)))
  if (!rule) fail('O tenant não tem pontuação padrão')
  return { ...pickRules(rule), ruleId: rule.id, ruleName: rule.name }
}

const ruleEntity = (ruleId: string) => ({ entityType: 'scoring_rule', entityId: ruleId })

function assertValidRule({ name, rules }: ScoringRuleInput) {
  assertValidName(name, 'da pontuação')
  const errors = validateRules(rules)
  if (errors.length) fail(errors.join('; '))
}

/** FOR UPDATE: duas operações no mesmo item se enfileiram, e a segunda enxerga o que a primeira gravou. */
async function loadRule(tx: Tx, me: AuthCtx, ruleId: string) {
  const [rule] = await tx.select().from(scoringRules).where(and(eq(scoringRules.id, ruleId), eq(scoringRules.tenantId, me.tenantId))).for('update')
  if (!rule) fail('Pontuação não encontrada')
  return rule
}

/** A padrão primeiro; cada pontuação com as equipes que a usam (na padrão, as sem pontuação própria). */
export async function listScoringRulesFor(me: AuthCtx) {
  requireCan(me, 'scoring.configure')
  const items = await db.select().from(scoringRules).where(eq(scoringRules.tenantId, me.tenantId)).orderBy(desc(scoringRules.isDefault), asc(scoringRules.name))
  const teamsOf = await teamsByItem(db, me.tenantId, scoringRuleLink)
  return items.map((rule) => ({ ...rule, teams: teamsOf.get(rule.isDefault ? null : rule.id) ?? [] }))
}

export async function createScoringRuleFor(me: AuthCtx, input: ScoringRuleInput) {
  requireCan(me, 'scoring.configure')
  assertValidRule(input)
  return db.transaction(async (tx) => {
    const [rule] = await failOnDuplicate(DUPLICATE_NAME, tx.insert(scoringRules).values({ tenantId: me.tenantId, name: input.name.trim(), ...pickRules(input.rules) }).returning())
    await recordAudit(tx, me, { action: 'scoring_rule.created', ...ruleEntity(rule!.id), meta: { name: rule!.name, ...pickRules(rule!) } })
    return rule!
  })
}

/** Tarefa já iniciada guarda a regra que valia no primeiro start: editar aqui só vale para as que ainda não começaram. */
export async function updateScoringRuleFor(me: AuthCtx, ruleId: string, input: ScoringRuleInput) {
  requireCan(me, 'scoring.configure')
  assertValidRule(input)
  return db.transaction(async (tx) => {
    const rule = await loadRule(tx, me, ruleId)
    const [updated] = await failOnDuplicate(
      DUPLICATE_NAME,
      tx.update(scoringRules).set({ name: input.name.trim(), ...pickRules(input.rules) }).where(eq(scoringRules.id, rule.id)).returning(),
    )
    const changes = diffFields(rule, updated!, ['name', ...RULE_FIELDS])
    if (Object.keys(changes).length) await recordAudit(tx, me, { action: 'scoring_rule.updated', ...ruleEntity(rule.id), changes })
    return updated!
  })
}

/** As equipes da pontuação excluída voltam ao padrão: a FK zera o vínculo. */
export async function deleteScoringRuleFor(me: AuthCtx, ruleId: string) {
  requireCan(me, 'scoring.configure')
  await db.transaction(async (tx) => {
    const rule = await loadRule(tx, me, ruleId)
    if (rule.isDefault) fail('A pontuação padrão não pode ser excluída')
    const released = await tx.select({ id: teams.id }).from(teams).where(and(eq(teams.tenantId, me.tenantId), eq(teams.scoringRuleId, rule.id)))
    await tx.delete(scoringRules).where(eq(scoringRules.id, rule.id))
    await recordAudit(tx, me, {
      action: 'scoring_rule.deleted',
      ...ruleEntity(rule.id),
      meta: teamsAuditMeta(rule.name, { added: [], removed: released.map((team) => team.id) }),
    })
  })
}

/** Define exatamente as equipes da pontuação. A equipe fora da lista volta ao padrão; a que estava em outra pontuação passa para esta. */
export async function setScoringRuleTeamsFor(me: AuthCtx, ruleId: string, teamIds: ReadonlyArray<string>) {
  requireCan(me, 'scoring.configure')
  await db.transaction(async (tx) => {
    const rule = await loadRule(tx, me, ruleId)
    if (rule.isDefault) fail('A pontuação padrão vale para as equipes sem pontuação própria; vincule a equipe a outra pontuação')
    const diff = await replaceTeamsOfItem(tx, me.tenantId, scoringRuleLink, rule.id, teamIds)
    if (!diff.added.length && !diff.removed.length) return
    await recordAudit(tx, me, { action: 'scoring_rule.teams_changed', ...ruleEntity(rule.id), meta: teamsAuditMeta(rule.name, diff) })
  })
}
