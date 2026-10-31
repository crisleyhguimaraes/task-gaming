import { describe, expect, it } from 'vitest'
import { uniqueById } from './unique'

describe('uniqueById', () => {
  it('mantém a primeira ocorrência de cada id e a ordem', () => {
    const list = [
      { id: 'a', name: 'Ana', teamId: 't1' },
      { id: 'b', name: 'Bruno', teamId: 't1' },
      { id: 'b', name: 'Bruno', teamId: 't2' },
    ]

    expect(uniqueById(list)).toEqual([list[0], list[1]])
  })

  it('lista sem repetição fica igual e lista vazia continua vazia', () => {
    expect(uniqueById([{ id: 'a' }, { id: 'b' }])).toEqual([{ id: 'a' }, { id: 'b' }])
    expect(uniqueById([])).toEqual([])
  })
})
