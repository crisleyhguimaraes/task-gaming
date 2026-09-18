import { describe, expect, it } from 'vitest'
import { reaches } from './dependencies.core'

const e = (taskId: string, dependsOnTaskId: string) => ({ taskId, dependsOnTaskId })

describe('reaches (detecção de ciclo)', () => {
  it('ciclo direto: A→B e tentar B→A', () => {
    expect(reaches([e('A', 'B')], 'A', 'B')).toBe(true) // B depende de A? A→B já alcança B
  })
  it('ciclo indireto: A→B→C, tentar C→A', () => {
    expect(reaches([e('A', 'B'), e('B', 'C')], 'A', 'C')).toBe(true)
  })
  it('sem ciclo', () => {
    expect(reaches([e('A', 'B'), e('C', 'B')], 'A', 'C')).toBe(false)
  })
  it('grafo com ciclo pré-existente não trava', () => {
    expect(reaches([e('A', 'B'), e('B', 'A')], 'A', 'Z')).toBe(false)
  })
})
