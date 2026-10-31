/** Dias da semana como `Date#getUTCDay` e `extract(dow)`: 0 = domingo … 6 = sábado. */
export type GoalRule = { targetPoints: number; activeDays: ReadonlyArray<number> }

export const BUSINESS_DAYS: ReadonlyArray<number> = [1, 2, 3, 4, 5]

export const MIN_GOAL_POINTS = 10
export const MAX_GOAL_POINTS = 10_000

const SATURDAY = 6

const isDayOfWeek = (day: number) => Number.isInteger(day) && day >= 0 && day <= SATURDAY

export function validateGoal({ targetPoints, activeDays }: GoalRule): Array<string> {
  const errors: Array<string> = []
  if (!Number.isInteger(targetPoints) || targetPoints < MIN_GOAL_POINTS || targetPoints > MAX_GOAL_POINTS) {
    errors.push(`Meta deve ser um inteiro entre ${MIN_GOAL_POINTS} e ${MAX_GOAL_POINTS} pontos`)
  }
  if (activeDays.length === 0) errors.push('Escolha ao menos um dia ativo')
  else if (!activeDays.every(isDayOfWeek) || new Set(activeDays).size !== activeDays.length) {
    errors.push('Os dias ativos devem ser inteiros de 0 (domingo) a 6 (sábado), sem repetição')
  }
  return errors
}

/** Quem está em várias equipes cumpre a maior meta do dia, não a soma: entrar numa segunda equipe não duplica a cobrança. `null` = dia livre. */
export function goalForWeekday(goals: ReadonlyArray<GoalRule>, weekday: number): number | null {
  const targets = goals.filter((g) => g.activeDays.includes(weekday)).map((g) => g.targetPoints)
  return targets.length ? Math.max(...targets) : null
}

export const activeDaysOf = (goals: ReadonlyArray<GoalRule>): Array<number> =>
  [...new Set(goals.flatMap((g) => g.activeDays))].sort((a, b) => a - b)

export const MS_PER_DAY = 86_400_000
/** 'YYYY-MM-DD' (UTC) de uma data. */
export const dayKey = (d: Date) => d.toISOString().slice(0, 10)
/** Dia da semana (0 = domingo) de um 'YYYY-MM-DD'. */
export const weekdayOf = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay()
const dayBefore = (d: Date) => new Date(d.getTime() - MS_PER_DAY)

/** Dias consecutivos com conclusão válida, terminando hoje ou no último dia ativo. Dia livre sem conclusão não quebra; com conclusão conta. */
export function computeStreak(
  daysWithCompletion: Iterable<string>,
  today: string,
  activeDays: ReadonlyArray<number> = BUSINESS_DAYS,
) {
  // Sem dia ativo todo dia é livre e a busca por um dia que quebre a sequência não termina.
  if (activeDays.length === 0) return 0
  const done = new Set(daysWithCompletion)
  const isSkippable = (d: Date) => !activeDays.includes(d.getUTCDay()) && !done.has(dayKey(d))
  let cursor = new Date(`${today}T00:00:00Z`)
  const back = () => {
    cursor = dayBefore(cursor)
    while (isSkippable(cursor)) cursor = dayBefore(cursor)
  }
  if (!done.has(dayKey(cursor))) back() // hoje ainda não pontuou: a sequência segue viva até o fim do dia
  let n = 0
  while (done.has(dayKey(cursor))) {
    n++
    back()
  }
  return n
}
