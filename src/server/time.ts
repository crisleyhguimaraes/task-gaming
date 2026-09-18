// Tempo em segundos. Teto por bloco evita que uma tarefa esquecida aberta
// (browser fechado, almoço) destrua o ritmo — ver plano, "Abandono".
export const capFor = (estimatedSeconds: number) => Math.max(2 * estimatedSeconds, 30 * 60)

const secondsBetween = (a: Date, b: Date) => Math.max(0, Math.floor((b.getTime() - a.getTime()) / 1000))

export function closeLogDuration(startedAt: Date, now: Date, estimatedSeconds: number) {
  return Math.min(secondsBetween(startedAt, now), capFor(estimatedSeconds))
}

export type LogLike = { startedAt: Date; stoppedAt: Date | null; durationSeconds: number | null }

/** moving = soma dos blocos (com teto); elapsed = moving + gaps entre blocos (cada gap com teto). */
export function summarizeLogs(logs: Array<LogLike>, estimatedSeconds: number, now: Date) {
  const cap = capFor(estimatedSeconds)
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
