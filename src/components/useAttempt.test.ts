import { describe, expect, it } from 'vitest'
import { messageOf } from './useAttempt'

describe('messageOf', () => {
  it('usa a mensagem do Error', () => {
    expect(messageOf(new Error('Sem permissão'))).toBe('Sem permissão')
  })

  it('valor que não é Error cai no texto padrão', () => {
    expect(messageOf('boom')).toBe('Erro')
  })

  it('o texto padrão é de quem chama', () => {
    expect(messageOf(undefined, 'Erro ao criar')).toBe('Erro ao criar')
  })
})
