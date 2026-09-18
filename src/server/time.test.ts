import { describe, expect, it } from 'vitest'
import { capFor, closeLogDuration, summarizeLogs } from './time'

const t = (min: number) => new Date(Date.UTC(2026, 0, 1, 0, min))

describe('time', () => {
  it('cap = max(2×est, 30min)', () => {
    expect(capFor(600)).toBe(1800)
    expect(capFor(3600)).toBe(7200)
  })

  it('closeLogDuration trava no teto', () => {
    expect(closeLogDuration(t(0), t(10), 600)).toBe(600)
    expect(closeLogDuration(t(0), t(600), 600)).toBe(1800) // 10h esquecida → 30min
  })

  it('summarizeLogs soma blocos e gaps, ambos com teto', () => {
    const est = 600 // cap 1800
    const logs = [
      { startedAt: t(0), stoppedAt: t(10), durationSeconds: 600 },
      { startedAt: t(15), stoppedAt: t(20), durationSeconds: 300 }, // gap 5min
      { startedAt: t(600), stoppedAt: null, durationSeconds: null }, // gap ~9.6h → teto; bloco aberto 2min
    ]
    const r = summarizeLogs(logs, est, t(602))
    expect(r.movingSeconds).toBe(600 + 300 + 120)
    expect(r.elapsedSeconds).toBe(1020 + 300 + 1800)
  })

  it('sem logs → elapsed mínimo 1', () => {
    expect(summarizeLogs([], 600, t(0))).toEqual({ movingSeconds: 0, elapsedSeconds: 1 })
  })
})
