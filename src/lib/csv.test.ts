import { describe, expect, it } from 'vitest'
import { toCsv } from './csv'

const BOM = '﻿'
type Row = { name: string | null; value: string | number | boolean | Date | null }
const columns = [
  { header: 'Nome', value: (r: Row) => r.name },
  { header: 'Valor', value: (r: Row) => r.value },
]
const csv = (rows: Array<Row>) => toCsv(rows, columns)

describe('toCsv', () => {
  it('começa com BOM UTF-8, separa por ponto e vírgula (o que o Excel pt-BR espera) e quebra linha com CRLF', () => {
    expect(csv([{ name: 'Ana', value: 1 }])).toBe(`${BOM}Nome;Valor\r\nAna;1\r\n`)
  })

  it('sem linhas, só o cabeçalho', () => {
    expect(csv([])).toBe(`${BOM}Nome;Valor\r\n`)
  })

  it('cita células com ponto e vírgula, aspas ou quebra de linha, dobrando as aspas', () => {
    const out = csv([
      { name: 'a;b', value: 'diz "oi"' },
      { name: 'linha1\nlinha2', value: 'x' },
    ])
    expect(out).toBe(`${BOM}Nome;Valor\r\n"a;b";"diz ""oi"""\r\n"linha1\nlinha2";x\r\n`)
  })

  it('vírgula decimal passa sem aspas', () => {
    expect(csv([{ name: '1,5', value: 'y' }])).toBe(`${BOM}Nome;Valor\r\n1,5;y\r\n`)
  })

  it('null vira célula vazia; booleano e data viram texto', () => {
    const when = new Date('2026-03-01T10:00:00.000Z')
    expect(csv([{ name: null, value: true }, { name: 'd', value: when }])).toBe(`${BOM}Nome;Valor\r\n;true\r\nd;2026-03-01T10:00:00.000Z\r\n`)
  })

  it.each([
    ['=SOMA(A1)', "'=SOMA(A1)"],
    ['+1', "'+1"],
    ['-1+2', "'-1+2"],
    ['@cmd', "'@cmd"],
    ['\tx', "'\tx"],
    ['\rx', '"\'\rx"'],
  ])('texto %j que começa como fórmula ganha apóstrofo', (text, cell) => {
    expect(csv([{ name: text, value: 'ok' }])).toBe(`${BOM}Nome;Valor\r\n${cell};ok\r\n`)
  })

  it('apóstrofo é aplicado antes de citar', () => {
    expect(csv([{ name: '=1;2', value: 'ok' }])).toBe(`${BOM}Nome;Valor\r\n"'=1;2";ok\r\n`)
  })

  it('número negativo não é texto: não ganha apóstrofo', () => {
    expect(csv([{ name: 'saldo', value: -5 }])).toBe(`${BOM}Nome;Valor\r\nsaldo;-5\r\n`)
  })

  it('cabeçalho também é protegido', () => {
    expect(toCsv([], [{ header: '=cmd', value: () => null }])).toBe(`${BOM}'=cmd\r\n`)
  })
})
