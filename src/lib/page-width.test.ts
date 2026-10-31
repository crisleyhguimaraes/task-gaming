import { describe, expect, it } from 'vitest'
import { DEFAULT_PAGE_WIDTH, pageWidthClass } from './page-width'

describe('pageWidthClass', () => {
  it('full não limita a largura', () => {
    expect(pageWidthClass('full')).not.toContain('max-w')
  })

  it('cada largura limitada tem o seu teto e centraliza', () => {
    expect(pageWidthClass('wide')).toBe('mx-auto max-w-[1680px]')
    expect(pageWidthClass('narrow')).toBe('mx-auto max-w-[880px]')
  })

  it('rota sem declaração usa a largura ampla', () => {
    expect(DEFAULT_PAGE_WIDTH).toBe('wide')
  })
})
