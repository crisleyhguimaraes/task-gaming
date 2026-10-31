import { describe, expect, it } from 'vitest'
import { isDeepStrictEqual } from 'node:util'
import { FACTORY_RULES, scoreTask, validateRules } from './scoring'
import type { ScoreInput } from './scoring'

const base = { basePoints: 100, estimatedSeconds: 1000 }

describe('scoreTask', () => {
  it('no ritmo: pontos base', () => {
    expect(scoreTask({ ...base, movingSeconds: 1000, elapsedSeconds: 1000 })).toEqual({
      paceBonus: 0, overtimePenalty: 0, pausePenalty: 0, finalPoints: 100, needsValidation: false,
    })
  })
  it('rápido (<80%): +15%', () => {
    expect(scoreTask({ ...base, movingSeconds: 700, elapsedSeconds: 700 }).finalPoints).toBe(115)
  })
  it('relâmpago (<20%): retém pra validação', () => {
    const r = scoreTask({ ...base, movingSeconds: 100, elapsedSeconds: 100 })
    expect(r.needsValidation).toBe(true)
    expect(r.finalPoints).toBe(115)
  })
  it('estouro: -10% por degrau de 20% acima de 150%', () => {
    expect(scoreTask({ ...base, movingSeconds: 1600, elapsedSeconds: 1600 }).finalPoints).toBe(90) // 1 degrau
    expect(scoreTask({ ...base, movingSeconds: 1900, elapsedSeconds: 1900 }).finalPoints).toBe(80) // 2 degraus
  })
  it('muita pausa (<40% ativo): -20%', () => {
    expect(scoreTask({ ...base, movingSeconds: 1000, elapsedSeconds: 3000 }).finalPoints).toBe(80)
  })
  it('piso de 50%', () => {
    expect(scoreTask({ ...base, movingSeconds: 5000, elapsedSeconds: 20000 }).finalPoints).toBe(50)
  })
})

// Cópia congelada da fórmula anterior à parametrização: é a referência da paridade, não editar.
function legacyScoreTask({ basePoints, estimatedSeconds, movingSeconds, elapsedSeconds }: ScoreInput) {
  const r = movingSeconds / estimatedSeconds
  const needsValidation = movingSeconds < 0.2 * estimatedSeconds
  const paceBonus = r < 0.8 ? Math.round(basePoints * 0.15) : 0
  const overtimePenalty = r > 1.5 ? -Math.round(basePoints * 0.1 * (Math.floor((r - 1.5) / 0.2) + 1)) : 0
  const pausePenalty = movingSeconds / elapsedSeconds < 0.4 ? -Math.round(basePoints * 0.2) : 0
  const finalPoints = Math.max(
    Math.round(basePoints * 0.5),
    basePoints + paceBonus + overtimePenalty + pausePenalty,
  )
  return { paceBonus, overtimePenalty, pausePenalty, finalPoints, needsValidation }
}

const around = (n: number) => [n - 1, n, n + 1].filter((v) => v >= 0)

function* scenarios(): Generator<ScoreInput> {
  const estimates = [0, 1, 7, 600, 1000, 3600]
  const movingOverEstimate = [0, 0.05, 0.19, 0.2, 0.21, 0.5, 0.79, 0.8, 0.81, 1, 1.49, 1.5, 1.51, 1.69, 1.7, 1.71, 1.9, 2.1, 5]
  const elapsedOverMoving = [1, 2, 2.4, 2.5, 2.6, 10]
  for (const estimatedSeconds of estimates) {
    for (const ratio of movingOverEstimate) {
      for (const movingSeconds of around(Math.round(estimatedSeconds * ratio))) {
        const elapsed = [0, 1, ...elapsedOverMoving.map((k) => Math.round(movingSeconds * k))]
        for (const elapsedSeconds of new Set(elapsed)) {
          for (let basePoints = 1; basePoints <= 2000; basePoints++) {
            yield { basePoints, estimatedSeconds, movingSeconds, elapsedSeconds }
          }
        }
      }
    }
  }
}

describe('regras de fábrica', () => {
  it('são os valores praticados antes de a pontuação ser parametrizável', () => {
    expect(FACTORY_RULES).toEqual({
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
    })
  })

  it('dão o mesmo resultado da fórmula antiga, para base de 1 a 2000, nos limiares e com tempos 0', () => {
    const divergences = []
    for (const input of scenarios()) {
      const expected = legacyScoreTask(input)
      const actual = scoreTask(input, FACTORY_RULES)
      if (!isDeepStrictEqual(actual, expected)) divergences.push({ input, expected, actual })
      if (divergences.length === 5) break
    }
    expect(divergences).toEqual([])
  })

  it('são o padrão quando nenhuma regra é passada', () => {
    const input = { basePoints: 100, estimatedSeconds: 1000, movingSeconds: 1700, elapsedSeconds: 1900 }
    expect(scoreTask(input)).toEqual(scoreTask(input, FACTORY_RULES))
  })
})

describe('scoreTask com regras customizadas', () => {
  const input = { basePoints: 100, estimatedSeconds: 1000, elapsedSeconds: 1000 }

  it('relâmpago em outro limiar', () => {
    const rules = { ...FACTORY_RULES, validateBelowPct: 50 }
    expect(scoreTask({ ...input, movingSeconds: 400, elapsedSeconds: 400 }, rules).needsValidation).toBe(true)
    expect(scoreTask({ ...input, movingSeconds: 400, elapsedSeconds: 400 }).needsValidation).toBe(false)
  })

  it('bônus de ritmo com limiar e percentual próprios', () => {
    const rules = { ...FACTORY_RULES, paceBelowPct: 90, paceBonusPct: 25 }
    expect(scoreTask({ ...input, movingSeconds: 850, elapsedSeconds: 850 }, rules).finalPoints).toBe(125)
  })

  it('estouro com início, degrau e penalidade próprios', () => {
    const rules = { ...FACTORY_RULES, overtimeAbovePct: 120, overtimeStepPct: 10, overtimePenaltyPct: 5 }
    expect(scoreTask({ ...input, movingSeconds: 1250, elapsedSeconds: 1250 }, rules).finalPoints).toBe(95) // 1 degrau
    expect(scoreTask({ ...input, movingSeconds: 1350, elapsedSeconds: 1350 }, rules).finalPoints).toBe(90) // 2 degraus
  })

  it('pausa com limiar e penalidade próprios', () => {
    const rules = { ...FACTORY_RULES, pauseBelowPct: 60, pausePenaltyPct: 30 }
    expect(scoreTask({ ...input, movingSeconds: 1000, elapsedSeconds: 1900 }, rules).finalPoints).toBe(70)
    expect(scoreTask({ ...input, movingSeconds: 1000, elapsedSeconds: 1900 }).finalPoints).toBe(100)
  })

  it('piso próprio', () => {
    const rules = { ...FACTORY_RULES, floorPct: 90 }
    expect(scoreTask({ ...input, movingSeconds: 5000, elapsedSeconds: 20000 }, rules).finalPoints).toBe(90)
  })
})

describe('validateRules', () => {
  it('as regras de fábrica são coerentes', () => {
    expect(validateRules(FACTORY_RULES)).toEqual([])
  })

  it.each([
    ['limiares fora de ordem: validação >= ritmo', { validateBelowPct: 80 }, 'validação'],
    ['limiares fora de ordem: ritmo >= estouro', { paceBelowPct: 150 }, 'validação'],
    ['piso zero', { floorPct: 0 }, 'piso'],
    ['piso acima de 100', { floorPct: 101 }, 'piso'],
    ['degrau zero', { overtimeStepPct: 0 }, 'degrau'],
    ['percentual negativo', { pausePenaltyPct: -1 }, 'inteiros'],
    ['percentual fracionário', { paceBonusPct: 7.5 }, 'inteiros'],
    ['multiplicador do teto abaixo de 1', { capMultiplier: 0 }, 'multiplicador'],
    ['multiplicador do teto fracionário', { capMultiplier: 1.5 }, 'multiplicador'],
    ['teto mínimo zero', { capMinMinutes: 0 }, 'teto mínimo'],
  ])('rejeita %s', (_name, change, mention) => {
    expect(validateRules({ ...FACTORY_RULES, ...change })).toEqual([expect.stringContaining(mention)])
  })

  it('lista todos os erros de uma vez', () => {
    expect(validateRules({ ...FACTORY_RULES, floorPct: 0, capMinMinutes: 0 })).toHaveLength(2)
  })
})
