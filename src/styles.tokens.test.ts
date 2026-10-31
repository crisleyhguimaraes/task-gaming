import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { contrastRatio } from './lib/contrast'

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

const blockAfter = (marker: string) => {
  const start = css.indexOf(marker)
  return css.slice(start, css.indexOf('}', start))
}

const tokensOf = (block: string) => new Map([...block.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1]!, m[2]!]))

const dark = tokensOf(blockAfter('@theme {'))
const light = new Map([...dark, ...tokensOf(blockAfter("html[data-theme='light'] {"))])

const MIN_AA = 4.5
const WHITE = '#ffffff'

type Pair = [foreground: string, background: string]

function failures(theme: Map<string, string>, pairs: Array<Pair>) {
  const color = (token: string) => (token === 'white' ? WHITE : theme.get(token))
  return pairs.flatMap(([fg, bg]) => {
    const [a, b] = [color(fg), color(bg)]
    if (!a || !b) return [`${fg} sobre ${bg}: token ausente`]
    const ratio = contrastRatio(a, b)
    return ratio >= MIN_AA ? [] : [`${fg} sobre ${bg}: ${ratio.toFixed(2)}`]
  })
}

describe('contraste dos tokens', () => {
  it('tema claro: texto, acento e estados passam em AA', () => {
    expect(
      failures(light, [
        ['neutral-50', 'neutral-950'],
        ['neutral-50', 'neutral-900'],
        ['neutral-400', 'neutral-900'],
        ['neutral-500', 'neutral-900'],
        ['neutral-500', 'neutral-950'],
        ['white', 'brand'],
        ['white', 'brand-hover'],
        ['brand-ink', 'brand-soft'],
        ['brand-ink', 'neutral-900'],
        ['xp-400', 'neutral-900'],
        ['xp-400', 'xp-950'],
        ['rose-400', 'rose-950'],
        ['amber-300', 'amber-950'],
        ['amber-400', 'neutral-900'],
      ]),
    ).toEqual([])
  })

  it('tema escuro: texto, acento e verde passam em AA', () => {
    expect(
      failures(dark, [
        ['neutral-100', 'neutral-950'],
        ['neutral-100', 'neutral-900'],
        ['neutral-400', 'neutral-900'],
        ['neutral-500', 'neutral-900'],
        ['neutral-500', 'neutral-950'],
        ['white', 'brand'],
        ['white', 'brand-hover'],
        ['brand-ink', 'brand-soft'],
        ['brand-ink', 'neutral-900'],
        ['xp-400', 'neutral-900'],
      ]),
    ).toEqual([])
  })
})
