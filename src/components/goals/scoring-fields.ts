import type { ScoringRules } from '#/server/scoring'

type Field = { key: keyof ScoringRules; label: string }
type Group = { title: string; hint: string; fields: ReadonlyArray<Field> }

export const SCORING_GROUPS: ReadonlyArray<Group> = [
  {
    title: 'Conclusão rápida demais',
    hint: 'Terminar mais rápido que isso retém os pontos até o líder validar.',
    fields: [{ key: 'validateBelowPct', label: 'Abaixo de (% do estimado)' }],
  },
  {
    title: 'Bônus de ritmo',
    hint: 'Terminar antes do estimado rende pontos extras.',
    fields: [
      { key: 'paceBelowPct', label: 'Abaixo de (% do estimado)' },
      { key: 'paceBonusPct', label: 'Bônus (% dos pontos base)' },
    ],
  },
  {
    title: 'Estouro de tempo',
    hint: 'Passou do estimado: perde pontos a cada degrau de tempo extra.',
    fields: [
      { key: 'overtimeAbovePct', label: 'Acima de (% do estimado)' },
      { key: 'overtimeStepPct', label: 'A cada (% do estimado extra)' },
      { key: 'overtimePenaltyPct', label: 'Perde por degrau (% dos pontos base)' },
    ],
  },
  {
    title: 'Pausa demais',
    hint: 'Pouco tempo ativo diante do tempo decorrido desconta pontos.',
    fields: [
      { key: 'pauseBelowPct', label: 'Ativo abaixo de (% do decorrido)' },
      { key: 'pausePenaltyPct', label: 'Perde (% dos pontos base)' },
    ],
  },
  {
    title: 'Piso',
    hint: 'A tarefa nunca rende menos que isso.',
    fields: [{ key: 'floorPct', label: 'Mínimo (% dos pontos base)' }],
  },
  {
    title: 'Teto de abandono',
    hint: 'Um bloco esquecido aberto trava em max(múltiplo × estimado, mínimo).',
    fields: [
      { key: 'capMultiplier', label: 'Múltiplo do estimado (×)' },
      { key: 'capMinMinutes', label: 'Mínimo (minutos)' },
    ],
  },
]

export type RuleValues = Record<keyof ScoringRules, string>

const FIELD_KEYS = SCORING_GROUPS.flatMap((group) => group.fields.map((field) => field.key))

export const valuesOf = (rules: ScoringRules) => Object.fromEntries(FIELD_KEYS.map((key) => [key, String(rules[key])])) as RuleValues

// Campo em branco vira NaN: `Number('')` é 0, e 0 é válido em vários campos, então passaria como se tivesse sido digitado.
const numberOf = (text: string) => (text.trim() === '' ? NaN : Number(text))

export const rulesOf = (values: RuleValues) => Object.fromEntries(FIELD_KEYS.map((key) => [key, numberOf(values[key])])) as ScoringRules
