import { describe, expect, it } from 'vitest'
import { computeStreak } from './stats'

describe('computeStreak', () => {
  it('conta dias consecutivos até hoje', () => {
    expect(computeStreak(['2026-09-16', '2026-09-17', '2026-09-18'], '2026-09-18')).toBe(3)
  })
  it('hoje sem tarefa ainda: continua vivo a partir de ontem', () => {
    expect(computeStreak(['2026-09-16', '2026-09-17'], '2026-09-18')).toBe(2)
  })
  it('buraco quebra', () => {
    expect(computeStreak(['2026-09-15', '2026-09-17'], '2026-09-17')).toBe(1)
  })
  it('fim de semana sem tarefa não quebra (sex → seg)', () => {
    // 2026-09-18 é sexta; 21 é segunda
    expect(computeStreak(['2026-09-17', '2026-09-18', '2026-09-21'], '2026-09-21')).toBe(3)
  })
  it('tarefa no sábado conta', () => {
    expect(computeStreak(['2026-09-18', '2026-09-19', '2026-09-21'], '2026-09-21')).toBe(3)
  })
  it('sem nada → 0', () => {
    expect(computeStreak([], '2026-09-18')).toBe(0)
  })
})
