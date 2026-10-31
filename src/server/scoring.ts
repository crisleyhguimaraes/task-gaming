export type ScoreInput = {
  basePoints: number
  estimatedSeconds: number
  movingSeconds: number
  elapsedSeconds: number
}

/** Todos os limiares são percentuais inteiros; os tetos de abandono são multiplicador do estimado e minutos. */
export type ScoringRules = {
  validateBelowPct: number
  paceBelowPct: number
  paceBonusPct: number
  overtimeAbovePct: number
  overtimeStepPct: number
  overtimePenaltyPct: number
  pauseBelowPct: number
  pausePenaltyPct: number
  floorPct: number
  capMultiplier: number
  capMinMinutes: number
}

export const FACTORY_RULES: ScoringRules = {
  validateBelowPct: 20,
  paceBelowPct: 80,
  paceBonusPct: 15,
  overtimeAbovePct: 150,
  overtimeStepPct: 20,
  overtimePenaltyPct: 10,
  pauseBelowPct: 40,
  pausePenaltyPct: 20,
  floorPct: 50,
  capMultiplier: 2,
  capMinMinutes: 30,
}

// NOTE: pct/100 em ponto flutuante reproduz a fórmula original bit a bit, inclusive o ruído nos degraus de 170%, 190%…; inteiro exato mudaria uns pontos ali.
const fraction = (pct: number) => pct / 100

export function scoreTask(
  { basePoints, estimatedSeconds, movingSeconds, elapsedSeconds }: ScoreInput,
  rules: ScoringRules = FACTORY_RULES,
) {
  const r = movingSeconds / estimatedSeconds
  const overtimeAbove = fraction(rules.overtimeAbovePct)
  const needsValidation = movingSeconds < fraction(rules.validateBelowPct) * estimatedSeconds // relâmpago: líder valida
  const paceBonus = r < fraction(rules.paceBelowPct) ? Math.round(basePoints * fraction(rules.paceBonusPct)) : 0
  const overtimeSteps = Math.floor((r - overtimeAbove) / fraction(rules.overtimeStepPct)) + 1
  const overtimePenalty = r > overtimeAbove ? -Math.round(basePoints * fraction(rules.overtimePenaltyPct) * overtimeSteps) : 0
  const pausePenalty =
    movingSeconds / elapsedSeconds < fraction(rules.pauseBelowPct) ? -Math.round(basePoints * fraction(rules.pausePenaltyPct)) : 0
  const finalPoints = Math.max(
    Math.round(basePoints * fraction(rules.floorPct)),
    basePoints + paceBonus + overtimePenalty + pausePenalty,
  )
  return { paceBonus, overtimePenalty, pausePenalty, finalPoints, needsValidation }
}

const PERCENT_FIELDS = [
  'validateBelowPct',
  'paceBelowPct',
  'paceBonusPct',
  'overtimeAbovePct',
  'overtimeStepPct',
  'overtimePenaltyPct',
  'pauseBelowPct',
  'pausePenaltyPct',
  'floorPct',
] as const satisfies ReadonlyArray<keyof ScoringRules>

const isIntegerAtLeast = (value: number, min: number) => Number.isInteger(value) && value >= min

export function validateRules(rules: ScoringRules): Array<string> {
  const checks: Array<[ok: boolean, message: string]> = [
    [PERCENT_FIELDS.every((field) => isIntegerAtLeast(rules[field], 0)), 'Os percentuais devem ser inteiros não negativos'],
    [
      rules.validateBelowPct < rules.paceBelowPct && rules.paceBelowPct < rules.overtimeAbovePct,
      'Os limiares devem crescer: validação < ritmo < estouro',
    ],
    [isIntegerAtLeast(rules.floorPct, 1) && rules.floorPct <= 100, 'O piso deve ser de 1% a 100%'],
    [isIntegerAtLeast(rules.overtimeStepPct, 1), 'O degrau de estouro deve ser de pelo menos 1%'],
    [isIntegerAtLeast(rules.capMultiplier, 1), 'O multiplicador do teto deve ser um inteiro de pelo menos 1'],
    [isIntegerAtLeast(rules.capMinMinutes, 1), 'O teto mínimo deve ser um inteiro de pelo menos 1 minuto'],
  ]
  return checks.filter(([ok]) => !ok).map(([, message]) => message)
}
