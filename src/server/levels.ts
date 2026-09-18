/** Níveis por pontos totais. Tabela fixa: mudar aqui muda pra todo mundo (não é por tenant). */
export const LEVELS = [
  { name: 'Iniciante', min: 0 },
  { name: 'Aprendiz', min: 100 },
  { name: 'Executor', min: 300 },
  { name: 'Veterano', min: 600 },
  { name: 'Especialista', min: 1000 },
  { name: 'Mestre', min: 1500 },
  { name: 'Lenda', min: 2500 },
] as const

export function levelFor(points: number) {
  let i = 0
  while (i + 1 < LEVELS.length && points >= LEVELS[i + 1]!.min) i++
  const cur = LEVELS[i]!
  const next = LEVELS[i + 1] ?? null
  const span = next ? next.min - cur.min : 1
  return {
    level: i + 1,
    name: cur.name,
    min: cur.min,
    next: next?.min ?? null,
    pct: next ? Math.round(((points - cur.min) / span) * 100) : 100,
    toNext: next ? next.min - points : 0,
  }
}
