import { describe, expect, it } from 'vitest'
import { assertValidName } from './validation'

describe('assertValidName', () => {
  it('aceita nome com 2 a 80 caracteres, ignorando espaços nas pontas', () => {
    expect(() => assertValidName('  Vendas  ', 'da equipe')).not.toThrow()
    expect(() => assertValidName('ab', 'da equipe')).not.toThrow()
    expect(() => assertValidName('a'.repeat(80), 'da equipe')).not.toThrow()
  })

  it('recusa nome curto ou longo demais, nomeando o assunto e os limites', () => {
    expect(() => assertValidName(' a ', 'do board')).toThrow('O nome do board precisa ter de 2 a 80 caracteres')
    expect(() => assertValidName('a'.repeat(81), 'do board')).toThrow('O nome do board precisa ter de 2 a 80 caracteres')
  })

  it('aceita um limite máximo próprio', () => {
    expect(() => assertValidName('a'.repeat(61), 'da etapa', 60)).toThrow('O nome da etapa precisa ter de 2 a 60 caracteres')
    expect(() => assertValidName('a'.repeat(100), 'da equipe', 100)).not.toThrow()
  })
})
