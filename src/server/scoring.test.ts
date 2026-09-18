import { describe, expect, it } from 'vitest'
import { scoreTask } from './scoring'

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
