import { useRouter } from '@tanstack/react-router'
import * as React from 'react'
import type { listScoringRules } from '#/server/scoring-rules'
import { createScoringRule, deleteScoringRule, setScoringRuleTeams, updateScoringRule } from '#/server/scoring-rules'
import { FACTORY_RULES, validateRules } from '#/server/scoring'
import type { ScoringRules } from '#/server/scoring'
import { CatalogPanel } from './CatalogPanel'
import { allTeams, otherOwners, useAttempt } from './model'
import { ScoringExample } from './ScoringExample'
import { SCORING_GROUPS, rulesOf, valuesOf } from './scoring-fields'
import type { RuleValues } from './scoring-fields'
import { TeamCheckboxes } from './TeamCheckboxes'

type RuleItem = Awaited<ReturnType<typeof listScoringRules>>[number]

export function ScoringTab({ rules }: { rules: ReadonlyArray<RuleItem> }) {
  const router = useRouter()
  const teams = allTeams(rules)

  async function save(rule: RuleItem | null, input: { name: string; rules: ScoringRules }, teamIds: Array<string>) {
    const scoringRuleId = rule?.id ?? (await createScoringRule({ data: input })).id
    if (rule) await updateScoringRule({ data: { scoringRuleId, ...input } })
    if (!rule?.isDefault) await setScoringRuleTeams({ data: { scoringRuleId, teamIds } })
    await router.invalidate()
  }

  return (
    <CatalogPanel
      noun="pontuação"
      createLabel="Nova pontuação"
      items={rules}
      summary={(rule) => <RuleSummary rule={rule} />}
      renderForm={(rule, close) => (
        <ScoringForm key={rule?.id ?? 'new'} rule={rule} teams={teams} owners={otherOwners(rules, rule?.id ?? null)} onSave={(input, teamIds) => save(rule, input, teamIds)} onClose={close} />
      )}
      onDelete={async (rule) => {
        await deleteScoringRule({ data: { scoringRuleId: rule.id } })
        await router.invalidate()
      }}
    />
  )
}

function RuleSummary({ rule }: { rule: RuleItem }) {
  return (
    <p className="text-sm text-neutral-400">
      Bônus de ritmo +{rule.paceBonusPct}% abaixo de {rule.paceBelowPct}% do estimado · estouro acima de {rule.overtimeAbovePct}% · piso {rule.floorPct}% · retém pontos abaixo de {rule.validateBelowPct}%
    </p>
  )
}

type FormProps = {
  rule: RuleItem | null
  teams: ReadonlyArray<{ id: string; name: string }>
  owners: ReadonlyMap<string, string>
  onSave: (input: { name: string; rules: ScoringRules }, teamIds: Array<string>) => Promise<void>
  onClose: () => void
}

function ScoringForm({ rule, teams, owners, onSave, onClose }: FormProps) {
  const [values, setValues] = React.useState<RuleValues>(valuesOf(rule ?? FACTORY_RULES))
  const { error, setError, attempt } = useAttempt()
  const headingId = `scoring-form-${rule?.id ?? 'new'}`

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const rules = rulesOf(values)
    const errors = validateRules(rules)
    if (errors.length) return setError(errors.join('; '))
    await attempt(async () => {
      await onSave({ name: String(f.get('name')), rules }, f.getAll('teamIds').map(String))
      onClose()
    })
  }

  return (
    <form onSubmit={submit} aria-labelledby={headingId} className="space-y-4">
      <h3 id={headingId} className="text-sm font-semibold">{rule ? `Editar ${rule.name}` : 'Nova pontuação'}</h3>
      <div className="space-y-1">
        <label htmlFor={`${headingId}-name`}>Nome</label>
        <input id={`${headingId}-name`} name="name" defaultValue={rule?.name ?? ''} required minLength={2} maxLength={80} />
      </div>
      <p className="text-xs text-neutral-500">Tarefa já iniciada guarda a pontuação que valia no primeiro início: editar aqui só vale para as que ainda não começaram.</p>
      {SCORING_GROUPS.map((group) => (
        <fieldset key={group.title} className="space-y-2">
          <legend className="text-sm font-medium text-neutral-200">{group.title}</legend>
          <p className="text-xs text-neutral-500">{group.hint}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {group.fields.map(({ key, label }) => (
              <div key={key} className="space-y-1">
                <label htmlFor={`${headingId}-${key}`}>{label}</label>
                <input
                  id={`${headingId}-${key}`}
                  type="number"
                  inputMode="numeric"
                  required
                  min={0}
                  step={1}
                  value={values[key]}
                  onChange={(e) => setValues({ ...values, [key]: e.target.value })}
                />
              </div>
            ))}
          </div>
        </fieldset>
      ))}
      <ScoringExample rules={rulesOf(values)} />
      {rule?.isDefault ? (
        <p className="text-xs text-neutral-500">A pontuação padrão vale para as equipes sem pontuação própria. Para tirar uma equipe dela, vincule a equipe a outra pontuação.</p>
      ) : (
        <TeamCheckboxes teams={teams} selected={rule?.teams ?? []} otherOwners={owners} noun="pontuação" />
      )}
      {error && <p role="alert" className="text-sm text-rose-400">{error}</p>}
      <div className="flex gap-2">
        <button className="btn-primary">Salvar</button>
        <button type="button" onClick={onClose} className="btn-ghost">Cancelar</button>
      </div>
    </form>
  )
}
