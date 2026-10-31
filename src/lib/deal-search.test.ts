import { describe, expect, it } from 'vitest'
import { matchesDeal } from './deal-search'

const deal = { title: 'Renovação anual', leadName: 'Mariana Souza' }

describe('matchesDeal', () => {
  it('consulta vazia ou só espaços casa tudo', () => {
    expect(matchesDeal(deal, '')).toBe(true)
    expect(matchesDeal(deal, '   ')).toBe(true)
  })

  it('casa por título ou por lead, sem diferenciar caixa nem acento', () => {
    expect(matchesDeal(deal, 'renovacao')).toBe(true)
    expect(matchesDeal(deal, 'MARIANA')).toBe(true)
  })

  it('exige a frase inteira, não palavras soltas', () => {
    expect(matchesDeal(deal, 'souza anual')).toBe(false)
  })

  it('não casa o que não está no título nem no lead', () => {
    expect(matchesDeal(deal, 'contrato')).toBe(false)
  })
})
