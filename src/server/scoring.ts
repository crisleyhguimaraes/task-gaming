export type ScoreInput = {
  basePoints: number
  estimatedSeconds: number
  movingSeconds: number
  elapsedSeconds: number
}

export function scoreTask({ basePoints, estimatedSeconds, movingSeconds, elapsedSeconds }: ScoreInput) {
  const r = movingSeconds / estimatedSeconds
  const needsValidation = movingSeconds < 0.2 * estimatedSeconds // relâmpago: líder valida
  const paceBonus = r < 0.8 ? Math.round(basePoints * 0.15) : 0
  const overtimePenalty =
    r > 1.5 ? -Math.round(basePoints * 0.1 * (Math.floor((r - 1.5) / 0.2) + 1)) : 0 // -10% a cada 20% extra
  const pausePenalty = movingSeconds / elapsedSeconds < 0.4 ? -Math.round(basePoints * 0.2) : 0
  const finalPoints = Math.max(
    Math.round(basePoints * 0.5),
    basePoints + paceBonus + overtimePenalty + pausePenalty,
  )
  return { paceBonus, overtimePenalty, pausePenalty, finalPoints, needsValidation }
}
