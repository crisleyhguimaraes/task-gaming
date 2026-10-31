import { FACTORY_RULES } from './scoring'
import type { ScoringRules } from './scoring'

const SECONDS_PER_MINUTE = 60

// Tempo em segundos. O teto evita que uma tarefa esquecida aberta (browser fechado, almoço) destrua o ritmo.
// Vale em dois momentos, sempre com a mesma regra: closeLogDuration, ao fechar o bloco (é o que fica gravado em durationSeconds),
// e summarizeLogs, ao totalizar a tarefa (limita de novo os blocos e, só ali, os gaps entre eles).
export const capFor = (estimatedSeconds: number, { capMultiplier, capMinMinutes }: ScoringRules = FACTORY_RULES) =>
  Math.max(capMultiplier * estimatedSeconds, capMinMinutes * SECONDS_PER_MINUTE)

const secondsBetween = (a: Date, b: Date) => Math.max(0, Math.floor((b.getTime() - a.getTime()) / 1000))

export function closeLogDuration(startedAt: Date, now: Date, estimatedSeconds: number, rules: ScoringRules = FACTORY_RULES) {
  return Math.min(secondsBetween(startedAt, now), capFor(estimatedSeconds, rules))
}

export type LogLike = { startedAt: Date; stoppedAt: Date | null; durationSeconds: number | null }

/** moving = soma dos blocos (com teto); elapsed = moving + gaps entre blocos (cada gap com teto). */
export function summarizeLogs(logs: Array<LogLike>, estimatedSeconds: number, now: Date, rules: ScoringRules = FACTORY_RULES) {
  const cap = capFor(estimatedSeconds, rules)
  const sorted = [...logs].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
  let moving = 0
  let gaps = 0
  let prevStop: Date | null = null
  for (const log of sorted) {
    const stop = log.stoppedAt ?? now
    const dur = Math.min(log.durationSeconds ?? secondsBetween(log.startedAt, stop), cap)
    if (prevStop) gaps += Math.min(secondsBetween(prevStop, log.startedAt), cap)
    moving += dur
    prevStop = stop
  }
  return { movingSeconds: moving, elapsedSeconds: Math.max(1, moving + gaps) }
}
