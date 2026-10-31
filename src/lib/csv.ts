export type CsvCell = string | number | boolean | Date | null | undefined
export type CsvColumn<T> = { header: string; value: (row: T) => CsvCell }

const BOM = '﻿'
const LINE_BREAK = '\r\n'
const FORMULA_START = /^[=+\-@\t\r]/
// Excel pt-BR usa ponto e vírgula como separador de lista; com vírgula abriria tudo numa coluna só.
const DELIMITER = ';'
const NEEDS_QUOTES = /[";\r\n]/

// Excel e Sheets executam texto que começa assim; o apóstrofo o transforma em texto literal.
const neutralizeFormula = (text: string) => (FORMULA_START.test(text) ? `'${text}` : text)

function cellText(cell: CsvCell) {
  if (cell === null || cell === undefined) return ''
  if (typeof cell === 'number') return String(cell)
  return neutralizeFormula(cell instanceof Date ? cell.toISOString() : String(cell))
}

function escapeCell(cell: CsvCell) {
  const text = cellText(cell)
  return NEEDS_QUOTES.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

const line = (cells: Array<CsvCell>) => cells.map(escapeCell).join(DELIMITER) + LINE_BREAK

export function toCsv<T>(rows: Array<T>, columns: Array<CsvColumn<T>>) {
  const body = rows.map((row) => line(columns.map((c) => c.value(row))))
  return BOM + line(columns.map((c) => c.header)) + body.join('')
}
