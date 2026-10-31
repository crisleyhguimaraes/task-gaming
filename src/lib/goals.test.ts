import { describe, expect, it } from 'vitest'
import { BUSINESS_DAYS, activeDaysOf, computeStreak, goalForWeekday, validateGoal, weekdayOf } from './goals'

const goal = (targetPoints: number, activeDays: ReadonlyArray<number>) => ({ targetPoints, activeDays })

describe('validateGoal', () => {
  it('meta de dias úteis é válida', () => {
    expect(validateGoal(goal(100, BUSINESS_DAYS))).toEqual([])
  })
  it('aceita os limites 10 e 10000, domingo e sábado', () => {
    expect(validateGoal(goal(10, [0]))).toEqual([])
    expect(validateGoal(goal(10_000, [6]))).toEqual([])
  })
  it.each([9, 10_001, 99.5, Number.NaN])('rejeita pontos %s', (points) => {
    expect(validateGoal(goal(points, [1]))).toEqual([expect.stringContaining('Meta')])
  })
  it('rejeita sem dias ativos', () => {
    expect(validateGoal(goal(100, []))).toEqual([expect.stringContaining('dia')])
  })
  it.each([[[7]], [[-1]], [[1.5]], [[1, 1]]])('rejeita dias inválidos %j', (days) => {
    expect(validateGoal(goal(100, days))).toEqual([expect.stringContaining('dia')])
  })
  it('lista todos os erros de uma vez', () => {
    expect(validateGoal(goal(5, []))).toHaveLength(2)
  })
})

describe('weekdayOf', () => {
  it.each([
    ['2026-11-01', 0],
    ['2026-11-02', 1],
    ['2026-10-31', 6],
  ])('%s cai no dia %i da semana', (day, weekday) => {
    expect(weekdayOf(day)).toBe(weekday)
  })
})

describe('goalForWeekday', () => {
  const weekdays = goal(100, BUSINESS_DAYS)
  const weekend = goal(40, [0, 6])
  const heavy = goal(300, [1, 3])

  it('uma meta: vale nos dias ativos', () => {
    expect(goalForWeekday([weekdays], 2)).toBe(100)
  })
  it('dia fora dos dias ativos é livre (null)', () => {
    expect(goalForWeekday([weekdays], 6)).toBeNull()
    expect(goalForWeekday([weekdays], 0)).toBeNull()
  })
  it('sem metas: livre', () => {
    expect(goalForWeekday([], 1)).toBeNull()
  })
  it('várias equipes: a maior meta do dia', () => {
    expect(goalForWeekday([weekdays, heavy], 1)).toBe(300)
    expect(goalForWeekday([weekdays, heavy], 2)).toBe(100)
  })
  it('meta maior que não está ativa no dia não conta', () => {
    expect(goalForWeekday([weekdays, heavy], 4)).toBe(100)
    expect(goalForWeekday([weekdays, weekend], 6)).toBe(40)
  })
})

describe('activeDaysOf', () => {
  it('união ordenada, sem repetição', () => {
    expect(activeDaysOf([goal(100, [5, 3, 1]), goal(50, [3, 6])])).toEqual([1, 3, 5, 6])
  })
  it('sem metas: nenhum dia', () => {
    expect(activeDaysOf([])).toEqual([])
  })
})

describe('computeStreak', () => {
  describe('dias úteis', () => {
    it('conta dias consecutivos até hoje', () => {
      expect(computeStreak(['2026-09-16', '2026-09-17', '2026-09-18'], '2026-09-18', BUSINESS_DAYS)).toBe(3)
    })
    it('hoje sem tarefa ainda: continua vivo a partir de ontem', () => {
      expect(computeStreak(['2026-09-16', '2026-09-17'], '2026-09-18', BUSINESS_DAYS)).toBe(2)
    })
    it('buraco quebra', () => {
      expect(computeStreak(['2026-09-15', '2026-09-17'], '2026-09-17', BUSINESS_DAYS)).toBe(1)
    })
    it('fim de semana sem tarefa não quebra (sex → seg)', () => {
      // 2026-09-18 é sexta; 21 é segunda
      expect(computeStreak(['2026-09-17', '2026-09-18', '2026-09-21'], '2026-09-21', BUSINESS_DAYS)).toBe(3)
    })
    it('tarefa no sábado conta', () => {
      expect(computeStreak(['2026-09-18', '2026-09-19', '2026-09-21'], '2026-09-21', BUSINESS_DAYS)).toBe(3)
    })
    it('sem nada → 0', () => {
      expect(computeStreak([], '2026-09-18', BUSINESS_DAYS)).toBe(0)
    })
    it('sem informar os dias, vale dias úteis', () => {
      expect(computeStreak(['2026-09-18', '2026-09-21'], '2026-09-21')).toBe(2)
    })
  })

  // 2026-09-21 seg, 22 ter, 23 qua, 24 qui, 25 sex
  describe('dias ativos customizados (seg, qua, sex)', () => {
    const monWedFri = [1, 3, 5]

    it('terça fora dos dias ativos, com tarefa, conta', () => {
      expect(computeStreak(['2026-09-21', '2026-09-22', '2026-09-23'], '2026-09-23', monWedFri)).toBe(3)
    })
    it('terça fora dos dias ativos, sem tarefa, não quebra', () => {
      expect(computeStreak(['2026-09-21', '2026-09-23'], '2026-09-23', monWedFri)).toBe(2)
    })
    it('dia ativo sem tarefa quebra', () => {
      expect(computeStreak(['2026-09-21', '2026-09-25'], '2026-09-25', monWedFri)).toBe(1)
    })
    it('hoje é dia livre sem tarefa: a sequência segue viva', () => {
      expect(computeStreak(['2026-09-21'], '2026-09-22', monWedFri)).toBe(1)
    })
    it('ontem ativo sem tarefa, hoje livre: já quebrou', () => {
      expect(computeStreak(['2026-09-21'], '2026-09-24', monWedFri)).toBe(0)
    })
    it('união das equipes: terça passa a ser dia ativo e sem tarefa quebra', () => {
      const days = activeDaysOf([goal(100, monWedFri), goal(50, [2])])
      expect(computeStreak(['2026-09-21', '2026-09-23'], '2026-09-23', days)).toBe(1)
    })
    it('sem dia ativo algum: 0, sem laço infinito', () => {
      expect(computeStreak(['2026-09-21'], '2026-09-23', [])).toBe(0)
    })
  })
})
