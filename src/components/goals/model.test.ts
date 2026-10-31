import { describe, expect, it } from 'vitest'
import type { CatalogItem } from './model'
import { allTeams, otherOwners } from './model'

const team = (id: string, name = id) => ({ id, name })
const item = (id: string, isDefault: boolean, teams: CatalogItem['teams']): CatalogItem => ({ id, name: `Item ${id}`, isDefault, teams })

describe('allTeams', () => {
  it('reúne as equipes de todos os itens, ordenadas por nome', () => {
    const items = [item('padrao', true, [team('z', 'Zeta')]), item('x', false, [team('b', 'Beta'), team('a', 'Alfa')])]
    expect(allTeams(items).map((t) => t.name)).toEqual(['Alfa', 'Beta', 'Zeta'])
  })

  it('ordena em pt-BR: acento não joga a equipe para o fim', () => {
    const items = [item('x', false, [team('b', 'Beta'), team('a', 'Árvore'), team('z', 'Zeta')])]
    expect(allTeams(items).map((t) => t.name)).toEqual(['Árvore', 'Beta', 'Zeta'])
  })

  it('sem itens, nenhuma equipe', () => {
    expect(allTeams([])).toEqual([])
  })
})

describe('otherOwners', () => {
  const items = [item('padrao', true, [team('t0')]), item('a', false, [team('t1'), team('t2')]), item('b', false, [team('t3')])]

  it('mapeia cada equipe para o nome do item que ela usa', () => {
    expect(otherOwners(items, null)).toEqual(
      new Map([
        ['t1', 'Item a'],
        ['t2', 'Item a'],
        ['t3', 'Item b'],
      ]),
    )
  })

  it('o padrão não conta: é o que a equipe perde ao ser vinculada', () => {
    expect(otherOwners(items, null).has('t0')).toBe(false)
  })

  it('o item em edição não conta como dono de si mesmo', () => {
    expect([...otherOwners(items, 'a').keys()]).toEqual(['t3'])
  })
})
