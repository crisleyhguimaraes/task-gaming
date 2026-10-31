import { describe, expect, it } from 'vitest'
import { THEME_BOOT_SCRIPT, getTheme } from './theme'

function runBoot(stored: string | null | 'throws') {
  const documentElement = { dataset: { theme: 'light' } as { theme?: string } }
  const localStorage = {
    getItem: () => {
      if (stored === 'throws') throw new Error('bloqueado')
      return stored
    },
  }
  new Function('document', 'localStorage', THEME_BOOT_SCRIPT)({ documentElement }, localStorage)
  return documentElement.dataset.theme
}

describe('script de boot do tema', () => {
  it('quem escolheu escuro volta ao escuro', () => {
    expect(runBoot('dark')).toBeUndefined()
  })

  it('quem escolheu claro, ou ainda não escolheu, fica no claro', () => {
    expect(runBoot('light')).toBe('light')
    expect(runBoot(null)).toBe('light')
  })

  it('armazenamento bloqueado não derruba a página e fica no claro', () => {
    expect(runBoot('throws')).toBe('light')
  })
})

describe('getTheme', () => {
  it('sem document (servidor) o padrão é claro', () => {
    expect(getTheme()).toBe('light')
  })
})
