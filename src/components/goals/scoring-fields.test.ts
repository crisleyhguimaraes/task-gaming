import { describe, expect, it } from 'vitest'
import { FACTORY_RULES, validateRules } from '#/server/scoring'
import { SCORING_GROUPS, rulesOf, valuesOf } from './scoring-fields'

describe('campos de pontuação', () => {
  it('os grupos cobrem todas as regras, senão o campo novo some do formulário', () => {
    const shown = SCORING_GROUPS.flatMap((group) => group.fields.map((field) => field.key)).sort()
    expect(shown).toEqual(Object.keys(FACTORY_RULES).sort())
  })

  it('valuesOf escreve cada regra como texto de campo', () => {
    expect(valuesOf(FACTORY_RULES).floorPct).toBe('50')
  })

  it('rulesOf devolve os números que valuesOf escreveu', () => {
    expect(rulesOf(valuesOf(FACTORY_RULES))).toEqual(FACTORY_RULES)
  })

  it.each(['', '   '])('campo %j é inválido, não zero', (blank) => {
    const rules = rulesOf({ ...valuesOf(FACTORY_RULES), paceBonusPct: blank })
    expect(validateRules(rules)).not.toEqual([])
  })
})
