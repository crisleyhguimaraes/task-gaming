/** O BOM já vem no conteúdo; o Blob preserva os bytes UTF-8. */
export function downloadCsv({ filename, content }: { filename: string; content: string }) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
