import { describe, expect, it } from 'vitest'
import { applyColumnMapping, guessColumnMapping, normalizeEmail, normalizePhone, parseLeadRow, takeLeastLoaded } from './leads'

describe('normalização', () => {
  it('e-mail: tira espaços e põe em minúsculas', () => {
    expect(normalizeEmail('  Ana@Acme.COM ')).toBe('ana@acme.com')
  })

  it('telefone: mantém só os dígitos', () => {
    expect(normalizePhone('+55 (11) 98765-4321')).toBe('5511987654321')
  })
})

describe('parseLeadRow', () => {
  const valid = { name: 'Ana', company: 'Acme', email: 'Ana@Acme.com', phone: '(11) 98765-4321', source: 'site' }

  it('linha completa vira lead normalizado', () => {
    expect(parseLeadRow(valid)).toEqual({
      ok: true,
      lead: {
        name: 'Ana',
        company: 'Acme',
        email: 'Ana@Acme.com',
        emailNormalized: 'ana@acme.com',
        phone: '(11) 98765-4321',
        phoneDigits: '11987654321',
        source: 'site',
      },
    })
  })

  it('só o nome é obrigatório; campos em branco viram nulos', () => {
    const r = parseLeadRow({ name: '  Bia  ', company: ' ', email: '', phone: undefined })

    expect(r).toEqual({
      ok: true,
      lead: { name: 'Bia', company: null, email: null, emailNormalized: null, phone: null, phoneDigits: null, source: 'outro' },
    })
  })

  it('recusa nome vazio', () => {
    expect(parseLeadRow({ name: '   ' })).toEqual({ ok: false, errors: { name: 'Informe o nome' } })
  })

  it('recusa e-mail sem formato válido', () => {
    const r = parseLeadRow({ name: 'Ana', email: 'ana@acme' })

    expect(r).toEqual({ ok: false, errors: { email: 'E-mail inválido' } })
  })

  it('recusa telefone com menos de 8 dígitos, mas aceita 8', () => {
    expect(parseLeadRow({ name: 'Ana', phone: '1234-567' })).toMatchObject({ ok: false, errors: { phone: expect.any(String) } })
    expect(parseLeadRow({ name: 'Ana', phone: '1234-5678' })).toMatchObject({ ok: true })
  })

  it('recusa telefone com dígitos demais para a coluna', () => {
    expect(parseLeadRow({ name: 'Ana', phone: '1'.repeat(21) })).toMatchObject({ ok: false, errors: { phone: expect.any(String) } })
  })

  it('recusa textos maiores que as colunas', () => {
    const r = parseLeadRow({ name: 'x'.repeat(161), company: 'y'.repeat(161) })

    expect(r).toMatchObject({ ok: false, errors: { name: expect.any(String), company: expect.any(String) } })
  })

  it('junta os erros de todos os campos', () => {
    const r = parseLeadRow({ name: '', email: 'x', phone: '1' })

    expect(r.ok === false && Object.keys(r.errors).sort()).toEqual(['email', 'name', 'phone'])
  })

  it.each([
    ['Site', 'site'],
    ['Indicação', 'indicacao'],
    ['  EVENTO ', 'evento'],
    ['Outbound', 'outbound'],
  ])('origem "%s" é reconhecida como %s', (source, expected) => {
    expect(parseLeadRow({ name: 'Ana', source })).toMatchObject({ ok: true, lead: { source: expected } })
  })

  it('origem desconhecida ou ausente vira "outro"', () => {
    expect(parseLeadRow({ name: 'Ana', source: 'panfleto' })).toMatchObject({ lead: { source: 'outro' } })
    expect(parseLeadRow({ name: 'Ana' })).toMatchObject({ lead: { source: 'outro' } })
  })
})

describe('takeLeastLoaded', () => {
  it('escolhe quem tem menos oportunidades abertas e conta a nova', () => {
    const loads = [
      { id: 'a', name: 'Ana', open: 3 },
      { id: 'b', name: 'Bia', open: 1 },
    ]

    expect(takeLeastLoaded(loads)?.id).toBe('b')
    expect(loads[1]!.open).toBe(2)
  })

  it('empate se resolve pelo nome', () => {
    const loads = [
      { id: 'z', name: 'Zeca', open: 0 },
      { id: 'a', name: 'Ana', open: 0 },
    ]

    expect(takeLeastLoaded(loads)?.id).toBe('a')
  })

  it('em lote, reparte por igual', () => {
    const loads = [
      { id: 'a', name: 'Ana', open: 0 },
      { id: 'b', name: 'Bia', open: 0 },
    ]

    const picked = [1, 2, 3, 4].map(() => takeLeastLoaded(loads)!.id)

    expect(picked).toEqual(['a', 'b', 'a', 'b'])
  })

  it('sem ninguém na equipe, não há dono', () => {
    expect(takeLeastLoaded([])).toBeUndefined()
  })
})

describe('mapeamento de colunas', () => {
  it('adivinha pelas variações comuns de cabeçalho, ignorando acento, caixa e espaços', () => {
    const headers = ['  Nome Completo', 'Empresa', 'E-mail', 'Celular', 'Origem', 'Observações']

    expect(guessColumnMapping(headers)).toEqual({ name: 0, company: 1, email: 2, phone: 3, source: 4 })
  })

  it('cabeçalhos em inglês também funcionam; o que não reconhece fica de fora', () => {
    expect(guessColumnMapping(['Name', 'Email', 'Cargo'])).toEqual({ name: 0, email: 1 })
  })

  it('monta as linhas a partir do mapeamento; coluna sem mapa ou célula ausente vira undefined', () => {
    const rows = [
      ['Ana', 'ana@acme.com', 'x'],
      ['Bia'],
    ]

    expect(applyColumnMapping(rows, { name: 0, email: 1 })).toEqual([
      { name: 'Ana', company: undefined, email: 'ana@acme.com', phone: undefined, source: undefined },
      { name: 'Bia', company: undefined, email: undefined, phone: undefined, source: undefined },
    ])
  })
})
