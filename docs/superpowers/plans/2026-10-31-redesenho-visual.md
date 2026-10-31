# Redesenho visual Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao sistema a cara de um SaaS premium claro, com largura de tela total, casca nova e um pipeline em kanban com indicadores no topo.

**Architecture:** Tokens por papel (`brand`, `brand-soft`...) remapeiam a paleta existente, então a maior parte das telas muda de tom sem edição. O tema claro vira o padrão trocando só o valor inicial do atributo `data-theme`. A largura de cada rota é declarada em `staticData.pageWidth` e lida pelo `Shell`, que passa a ser composto por `Sidebar`, `Topbar` e `PageContainer`.

**Tech Stack:** TanStack Start/Router, React 19, Tailwind v4, Vitest, lucide-react, dnd-kit.

**Spec:** `docs/superpowers/specs/2026-10-31-redesenho-visual-design.md`

## Global Constraints

- Tema claro padrão; escuro mantido como opção no menu do usuário.
- Acento `brand` `#4C5BDC`; verde (`xp-*`) só para pontos, metas batidas e "no prazo". **Sem gradiente em violeta ou ciano**: o acento é sempre cor chapada.
- Contraste AA (4,5:1) em todo par de texto dos tokens; verificado por teste.
- Fonte Outfit mantida; raios 16 (cartão), 12 (controle), 999 (chip); escala tipográfica 12 / 13 / 14 / 16 / 20 / 28.
- Indicadores do pipeline **sem variação percentual** (não há histórico).
- `npx impeccable detect src/` termina sem achados (a linha de base tem 3: `Avatar.tsx`, `styles.css`, `kanban/Card.tsx`).
- Cada onda é um commit (ou mais) com `pnpm typecheck`, `pnpm lint` e `pnpm test` verdes; suíte atual (1198 testes) sem regressão.
- Comentários só para o POR QUÊ não óbvio; atalho deliberado em `// NOTE:` de uma linha; nunca TODO. Commits sem atribuição de IA. Lógica nova pura com teste escrito antes.
- Todo comando assume o diretório `/Users/crisley/Documents/Crisley/task-gaming`.

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `src/lib/contrast.ts` | razão de contraste WCAG entre dois `#rrggbb` |
| `src/styles.tokens.test.ts` | lê `src/styles.css` e exige AA nos pares de texto, nos dois temas |
| `src/styles.css` | tokens, `.btn-primary`, `.card`, tiles chapados |
| `src/lib/theme.ts` | script de boot (claro por padrão), `getTheme`, `setTheme` |
| `src/lib/page-width.ts` | tipo `PageWidth`, classe de largura e o tipo de `staticData` |
| `src/components/PageContainer.tsx`, `PageHeader.tsx` | largura e cabeçalho padronizados de página |
| `src/lib/navigation.ts` | modelo puro do menu (`buildNav`), filtrado por capability |
| `src/components/Shell.tsx`, `Sidebar.tsx`, `Topbar.tsx` | casca; `Topbar.tsx` exporta também `TopbarSlot` |
| `src/components/SearchField.tsx`, `FilterSelect.tsx`, `KpiCard.tsx` | peças reutilizadas por pipeline, board e leads |
| `src/lib/deal-status.ts`, `deal-search.ts`, `pipeline-kpis.ts` | regras puras do pipeline |
| `src/components/pipeline/*` | `Board`, `Column`, `Card`, `PipelineKpis`, `FunnelPanel` |

---

# Onda 1: tokens, tema claro padrão e casca

### Task 1: Razão de contraste

**Files:**
- Create: `src/lib/contrast.ts`
- Test: `src/lib/contrast.test.ts`

**Interfaces:**
- Produces: `contrastRatio(a: string, b: string): number` (hex `#rrggbb`, ordem indiferente)

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, expect, it } from 'vitest'
import { contrastRatio } from './contrast'

describe('contrastRatio', () => {
  it('preto sobre branco é 21 e a ordem dos argumentos não importa', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5)
  })

  it('cores iguais dão 1', () => {
    expect(contrastRatio('#4c5bdc', '#4c5bdc')).toBeCloseTo(1, 5)
  })

  it('o acento com texto branco passa de 4,5', () => {
    expect(contrastRatio('#ffffff', '#4c5bdc')).toBeCloseTo(5.47, 1)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/lib/contrast.test.ts`
Expected: FAIL (módulo `./contrast` não existe)

- [ ] **Step 3: Implementar**

```ts
const channel = (value: number) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16) / 255))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

export function contrastRatio(a: string, b: string) {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (lighter! + 0.05) / (darker! + 0.05)
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run src/lib/contrast.test.ts`
Expected: PASS (3 testes)

- [ ] **Step 5: Commit**

```bash
git add src/lib/contrast.ts src/lib/contrast.test.ts
git commit -m "Razão de contraste WCAG para validar os tokens"
```

### Task 2: Tokens do tema e peças que usam o acento

**Files:**
- Create: `src/styles.tokens.test.ts`
- Modify: `src/styles.css` (blocos `@theme`, `html[data-theme='light']`, `@layer base`, `@layer components`)
- Modify: `src/components/Avatar.tsx`

**Interfaces:**
- Consumes: `contrastRatio` (Task 1)
- Produces: utilitários Tailwind `bg-brand`, `bg-brand-hover`, `bg-brand-soft`, `text-brand-ink`, `ring-brand-ring`, `border-brand-ring` (de `--color-brand`, `--color-brand-hover`, `--color-brand-soft`, `--color-brand-ink`, `--color-brand-ring`)

- [ ] **Step 1: Escrever o teste que falha**

```ts
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/styles.tokens.test.ts`
Expected: FAIL com `brand: token ausente`, `neutral-500 sobre neutral-900: 3.86` (escuro) e `xp-400 sobre neutral-900: 3.46` (claro), entre outros.

- [ ] **Step 3: Ajustar os tokens em `src/styles.css`**

No bloco `@theme { ... }`, trocar a linha do `neutral-500` e acrescentar os tokens do acento (valores do tema escuro, que é a base):

```css
  --color-neutral-500: #9094b8;
```

```css
  /* Acento por papel (não por rampa): o mesmo nome serve nos dois temas. */
  --color-brand: #4c5bdc;
  --color-brand-hover: #3f4dc9;
  --color-brand-soft: #262b5c;
  --color-brand-ink: #aab4ff;
  --color-brand-ring: #7c8bf5;
```

No bloco `html[data-theme='light'] { ... }`, trocar `--color-neutral-500`, `--color-xp-400`, `--color-xp-500`, `--color-xp-600`, `--color-rose-400` e acrescentar o acento claro:

```css
  --color-neutral-500: #666a89;
  --color-xp-400: #15803d;
  --color-xp-500: #12703b;
  --color-xp-600: #0f5f33;
  --color-rose-400: #be123c;

  --color-brand-soft: #eef0fe;
  --color-brand-ink: #3f4dc9;
  --color-brand-ring: #5b6cf2;
```

Em `@layer base`, trocar o anel de foco e o foco dos campos:

```css
  :focus-visible {
    outline: 2px solid var(--color-brand-ring);
    outline-offset: 2px;
  }
```

```css
  input,
  select,
  textarea {
    @apply w-full rounded-xl border border-neutral-800 bg-neutral-950/60 px-3 py-2 text-sm text-neutral-100 outline-none placeholder:text-neutral-500 focus:border-brand-ring;
  }
```

Em `@layer components`, substituir `.btn-primary` (e apagar o bloco `html[data-theme='light'] .btn-primary`), o `.card` e os tiles violeta e ciano:

```css
  .btn-primary {
    @apply btn bg-brand text-white hover:bg-brand-hover;
  }
```

```css
  .card {
    @apply rounded-2xl border border-neutral-800 bg-neutral-900 p-4 shadow-[0_1px_2px_rgb(20_22_50/0.04)];
  }
```

```css
  .tile-cyan {
    @apply tile bg-sky-600 shadow-sky-500/20;
  }
  .tile-violet {
    @apply tile bg-brand shadow-brand-ring/20;
  }
```

- [ ] **Step 4: Avatar sem gradiente violeta**

Em `src/components/Avatar.tsx` trocar a lista `GRADIENTS` por cores chapadas (todas com 4,5:1 ou mais contra texto branco) e o uso dela:

```tsx
const FILLS = ['bg-brand', 'bg-emerald-700', 'bg-amber-700', 'bg-rose-600', 'bg-sky-700', 'bg-teal-700']
```

```tsx
    <span className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white ${FILLS[hash(name) % FILLS.length]} ${cls}`} aria-hidden>
```

(remover `bg-gradient-to-br` da classe e o array `GRADIENTS`; `hash` e o restante ficam iguais.)

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm vitest run src/styles.tokens.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS nos dois testes; typecheck e lint limpos.

- [ ] **Step 6: Detector**

Run: `npx -y impeccable detect src/`
Expected: restam só `src/components/kanban/Card.tsx` (`border-l-4`, resolvido na Task 13). Nenhum achado de `ai-color-palette`.

- [ ] **Step 7: Commit**

```bash
git add src/styles.css src/styles.tokens.test.ts src/components/Avatar.tsx
git commit -m "Tokens do acento azul-violeta, contraste AA e avatar chapado"
```

### Task 3: Tema claro como padrão

**Files:**
- Modify: `src/lib/theme.ts`
- Modify: `src/routes/__root.tsx`
- Modify: `src/components/Shell.tsx` (estado inicial do tema em `HeaderActions`; este trecho é reescrito na Task 7, então só ajuste se a Task 7 ainda não rodou)
- Test: `src/lib/theme.test.ts`

**Interfaces:**
- Produces: `THEME_BOOT_SCRIPT` (remove `data-theme` só se o usuário guardou `dark`); `getTheme(): Theme` devolve `'light'` quando não há `document`.

- [ ] **Step 1: Escrever o teste que falha**

```ts
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/lib/theme.test.ts`
Expected: FAIL (o script atual só trata `light`; `getTheme()` sem document devolve `dark`)

- [ ] **Step 3: Implementar em `src/lib/theme.ts`**

```ts
/** Aplicado antes da hidratação por um script inline no <head> (sem flash). O servidor sempre renderiza claro. */
export const THEME_BOOT_SCRIPT = `try{if(localStorage.getItem('theme')==='dark')delete document.documentElement.dataset.theme}catch(e){}`

export const getTheme = (): Theme => (typeof document === 'undefined' || document.documentElement.dataset.theme === 'light' ? 'light' : 'dark')
```

(`setTheme` e o tipo `Theme` ficam como estão: `dark` remove o atributo, `light` o define.)

- [ ] **Step 4: Renderizar claro no servidor**

Em `src/routes/__root.tsx`, o `<html>` passa a ser:

```tsx
    <html lang="pt-BR" data-theme="light" suppressHydrationWarning>
```

(manter a linha `// NOTE:` que já explica o `suppressHydrationWarning`.)

- [ ] **Step 5: Estado inicial do seletor**

Em `HeaderActions` (`src/components/Shell.tsx`), trocar `React.useState<Theme>('dark')` por `React.useState<Theme>('light')`.

- [ ] **Step 6: Rodar e ver passar**

Run: `pnpm vitest run src/lib/theme.test.ts && pnpm typecheck`
Expected: PASS; typecheck limpo.

- [ ] **Step 7: Conferir no navegador**

Run: abrir `http://localhost:3010/login` em janela sem dados do site (ou limpar `localStorage.theme`): a tela abre clara. Escolher "Escuro" no menu do avatar, recarregar: abre escuro, sem piscar.

- [ ] **Step 8: Commit**

```bash
git add src/lib/theme.ts src/lib/theme.test.ts src/routes/__root.tsx src/components/Shell.tsx
git commit -m "Tema claro passa a ser o padrão"
```

### Task 4: Largura de página e cabeçalho padronizado

**Files:**
- Create: `src/lib/page-width.ts`, `src/components/PageContainer.tsx`, `src/components/PageHeader.tsx`
- Test: `src/lib/page-width.test.ts`

**Interfaces:**
- Produces: `type PageWidth = 'full' | 'wide' | 'standard' | 'narrow'`; `pageWidthClass(width: PageWidth): string`; `DEFAULT_PAGE_WIDTH: PageWidth` (`'standard'`, 1180px, é o comportamento de hoje; sai na Task 18); `StaticDataRouteOption.pageWidth?: PageWidth`; `<PageContainer width>`; `<PageHeader title subtitle?>{ações}</PageHeader>`.

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_PAGE_WIDTH, pageWidthClass } from './page-width'

describe('pageWidthClass', () => {
  it('full não limita a largura', () => {
    expect(pageWidthClass('full')).not.toContain('max-w')
  })

  it('cada largura limitada tem o seu teto e centraliza', () => {
    expect(pageWidthClass('wide')).toBe('mx-auto max-w-[1680px]')
    expect(pageWidthClass('standard')).toBe('mx-auto max-w-[1180px]')
    expect(pageWidthClass('narrow')).toBe('mx-auto max-w-[880px]')
  })

  it('rota sem declaração mantém a largura de hoje', () => {
    expect(DEFAULT_PAGE_WIDTH).toBe('standard')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/lib/page-width.test.ts`
Expected: FAIL (módulo não existe)

- [ ] **Step 3: Implementar `src/lib/page-width.ts`**

```ts
export type PageWidth = 'full' | 'wide' | 'standard' | 'narrow'

const WIDTH_CLASS: Record<PageWidth, string> = {
  full: '',
  wide: 'mx-auto max-w-[1680px]',
  standard: 'mx-auto max-w-[1180px]',
  narrow: 'mx-auto max-w-[880px]',
}

export const DEFAULT_PAGE_WIDTH: PageWidth = 'standard'

export const pageWidthClass = (width: PageWidth) => WIDTH_CLASS[width]

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    pageWidth?: PageWidth
  }
}
```

- [ ] **Step 4: Componentes**

`src/components/PageContainer.tsx`:

```tsx
import type { PageWidth } from '#/lib/page-width'
import { pageWidthClass } from '#/lib/page-width'

export function PageContainer({ width, children }: { width: PageWidth; children: React.ReactNode }) {
  return <div className={pageWidthClass(width)}>{children}</div>
}
```

`src/components/PageHeader.tsx`:

```tsx
export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[28px] leading-8 font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-neutral-400">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  )
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm vitest run src/lib/page-width.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS; limpos.

- [ ] **Step 6: Commit**

```bash
git add src/lib/page-width.ts src/lib/page-width.test.ts src/components/PageContainer.tsx src/components/PageHeader.tsx
git commit -m "Largura declarada por rota e cabeçalho de página padronizado"
```

### Task 5: Modelo do menu

**Files:**
- Create: `src/lib/navigation.ts`
- Test: `src/lib/navigation.test.ts`

**Interfaces:**
- Consumes: `can`, `AuthCtx` (`#/server/roles`)
- Produces:
  - `type NavPath` (a união de rotas hoje em `Shell.tsx`: `'/' | '/challenges' | '/board' | '/team' | '/pipeline' | '/leads' | '/settings/teams' | '/settings/users' | '/settings/permissions' | '/settings/pipeline' | '/settings/boards' | '/settings/goals' | '/settings/audit' | '/admin/tenants'`)
  - `type NavItem = { to: NavPath; label: string; icon: LucideIcon }`
  - `type NavGroup = NavItem & { children: Array<NavItem> }`
  - `type NavSection = { label: string; items: Array<NavItem | NavGroup> }`
  - `isGroup(item): item is NavGroup`
  - `buildNav(me: Pick<AuthCtx, 'userId' | 'role' | 'memberships' | 'capabilityOverrides'>): Array<NavSection>`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, expect, it } from 'vitest'
import type { Role, TeamRole } from '#/lib/access'
import type { AuthCtx } from '#/server/roles'
import { buildNav, isGroup } from './navigation'

type Person = Pick<AuthCtx, 'userId' | 'role' | 'memberships' | 'capabilityOverrides'>

const person = (role: Role, memberships: Array<[string, TeamRole]> = []): Person => ({
  userId: 'me',
  role,
  memberships: memberships.map(([teamId, teamRole]) => ({ teamId, role: teamRole })),
  capabilityOverrides: {},
})

const labels = (me: Person) => buildNav(me).flatMap((s) => s.items.map((i) => i.label))
const settingsOf = (me: Person) => {
  const group = buildNav(me).flatMap((s) => s.items).find(isGroup)
  return group?.children.map((c) => c.label) ?? []
}

describe('buildNav', () => {
  it('membro vê o trabalho, o comercial e a equipe, sem configurações', () => {
    expect(labels(person('MEMBER', [['a', 'MEMBER']]))).toEqual(['Hoje', 'Desafios', 'Board', 'Pipeline', 'Leads', 'Equipe'])
  })

  it('as seções agrupam o menu por assunto', () => {
    expect(buildNav(person('MEMBER', [['a', 'MEMBER']])).map((s) => s.label)).toEqual(['Trabalho', 'Comercial', 'Equipe'])
  })

  it('admin ganha o grupo Configurações com as páginas que pode abrir', () => {
    expect(settingsOf(person('TENANT_ADMIN'))).toEqual(['Equipes', 'Usuários', 'Permissões', 'Pipelines', 'Boards', 'Metas e pontuação', 'Auditoria'])
  })

  it('líder vê só as configurações que a capability dele libera', () => {
    const leader = settingsOf(person('MEMBER', [['a', 'LEADER']]))
    expect(leader).toContain('Usuários')
    expect(leader).not.toContain('Permissões')
    expect(leader).not.toContain('Auditoria')
  })

  it('só o super admin vê Tenants', () => {
    expect(labels(person('TENANT_ADMIN'))).not.toContain('Tenants')
    expect(labels(person('SUPER_ADMIN'))).toContain('Tenants')
  })

  it('o grupo Configurações leva ao primeiro item visível', () => {
    const group = buildNav(person('TENANT_ADMIN')).flatMap((s) => s.items).find(isGroup)
    expect(group?.to).toBe('/settings/teams')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/lib/navigation.test.ts`
Expected: FAIL (módulo não existe)

- [ ] **Step 3: Implementar `src/lib/navigation.ts`**

```ts
import type { LucideIcon } from 'lucide-react'
import { Building2, Columns3, ContactRound, Funnel, Handshake, LayoutGrid, ScrollText, Settings, ShieldCheck, SlidersHorizontal, Sun, Trophy, UserCog, Users, UsersRound } from 'lucide-react'
import type { AuthCtx } from '#/server/roles'
import { can } from '#/server/roles'

export type NavPath =
  | '/'
  | '/challenges'
  | '/board'
  | '/team'
  | '/pipeline'
  | '/leads'
  | '/settings/teams'
  | '/settings/users'
  | '/settings/permissions'
  | '/settings/pipeline'
  | '/settings/boards'
  | '/settings/goals'
  | '/settings/audit'
  | '/admin/tenants'

export type NavItem = { to: NavPath; label: string; icon: LucideIcon }
export type NavGroup = NavItem & { children: Array<NavItem> }
export type NavSection = { label: string; items: Array<NavItem | NavGroup> }

export const isGroup = (item: NavItem | NavGroup): item is NavGroup => 'children' in item

type Viewer = Pick<AuthCtx, 'userId' | 'role' | 'memberships' | 'capabilityOverrides'>

function settingsGroup(me: Viewer): NavGroup | null {
  const candidates: Array<NavItem & { show: boolean }> = [
    { to: '/settings/teams', label: 'Equipes', icon: UsersRound, show: can(me, 'team.manage') },
    { to: '/settings/users', label: 'Usuários', icon: UserCog, show: can(me, 'user.read') },
    { to: '/settings/permissions', label: 'Permissões', icon: ShieldCheck, show: can(me, 'permissions.manage') },
    { to: '/settings/pipeline', label: 'Pipelines', icon: Funnel, show: can(me, 'pipeline.configure') },
    { to: '/settings/boards', label: 'Boards', icon: LayoutGrid, show: can(me, 'board.manage') },
    { to: '/settings/goals', label: 'Metas e pontuação', icon: SlidersHorizontal, show: can(me, 'goal.configure') || can(me, 'scoring.configure') || can(me, 'tenant.configure') },
    { to: '/settings/audit', label: 'Auditoria', icon: ScrollText, show: can(me, 'audit.read') },
  ]
  const children = candidates.filter((c) => c.show).map(({ show: _show, ...item }) => item)
  const first = children[0]
  return first ? { to: first.to, label: 'Configurações', icon: Settings, children } : null
}

export function buildNav(me: Viewer): Array<NavSection> {
  const settings = settingsGroup(me)
  const system: Array<NavItem | NavGroup> = [...(settings ? [settings] : []), ...(me.role === 'SUPER_ADMIN' ? [{ to: '/admin/tenants' as const, label: 'Tenants', icon: Building2 }] : [])]
  const sections: Array<NavSection> = [
    {
      label: 'Trabalho',
      items: [
        { to: '/', label: 'Hoje', icon: Sun },
        { to: '/challenges', label: 'Desafios', icon: Trophy },
        { to: '/board', label: 'Board', icon: Columns3 },
      ],
    },
    {
      label: 'Comercial',
      items: [
        { to: '/pipeline', label: 'Pipeline', icon: Handshake },
        { to: '/leads', label: 'Leads', icon: ContactRound },
      ],
    },
    { label: 'Equipe', items: [{ to: '/team', label: 'Equipe', icon: Users }] },
    { label: 'Sistema', items: system },
  ]
  return sections.filter((s) => s.items.length > 0)
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run src/lib/navigation.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS (6 testes); limpos. Se o lint reclamar da variável `_show`, trocar o `map` por um `filter` seguido de `({ to, label, icon }) => ({ to, label, icon })`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/navigation.ts src/lib/navigation.test.ts
git commit -m "Modelo do menu em seções, filtrado por capability"
```

### Task 6: Casca nova (barra lateral, topbar, container)

**Files:**
- Create: `src/components/Sidebar.tsx`, `src/components/Topbar.tsx`
- Modify: `src/components/Shell.tsx`

**Interfaces:**
- Consumes: `buildNav`, `isGroup` (Task 5); `PageContainer`, `DEFAULT_PAGE_WIDTH` (Task 4)
- Produces: `TOPBAR_SLOT_ID = 'topbar-slot'`, `<TopbarSlot>{filhos}</TopbarSlot>` (de `Topbar.tsx`): renderiza os filhos dentro do espaço de busca da topbar; páginas com busca o usam.

- [ ] **Step 1: `src/components/Topbar.tsx`**

Mover para cá o componente `HeaderActions` e a constante `roundBtn` do `Shell.tsx` atual sem mudar o comportamento (tema, sino, equipe, menu do avatar), exportando `Topbar` e `TopbarSlot`:

```tsx
import { Link } from '@tanstack/react-router'
import * as React from 'react'
import { createPortal } from 'react-dom'
// ...imports que HeaderActions já usa (ClipboardList, LogOut, Moon, SunMedium, UserCircle, authClient/getTheme/setTheme/Theme, Avatar, NotificationBell, displayRole)

export const TOPBAR_SLOT_ID = 'topbar-slot'

/** Leva os filhos para o espaço de busca da topbar; só existe no cliente, depois de montado. */
export function TopbarSlot({ children }: { children: React.ReactNode }) {
  const [target, setTarget] = React.useState<HTMLElement | null>(null)
  React.useEffect(() => setTarget(document.getElementById(TOPBAR_SLOT_ID)), [])
  return target ? createPortal(children, target) : null
}

export function Topbar(props: { me: Pick<AuthCtx, 'name' | 'role' | 'memberships'>; attention: { pool: number; validation: number }; onSignOut: () => void }) {
  return (
    <div className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-neutral-800 bg-neutral-950/85 px-4 backdrop-blur lg:px-8">
      <div id={TOPBAR_SLOT_ID} className="min-w-0 flex-1" />
      <HeaderActions {...props} />
    </div>
  )
}
```

`HeaderActions` perde o `mb-4` do contêiner (a topbar já dá o espaçamento) e mantém tudo o mais.

- [ ] **Step 2: `src/components/Sidebar.tsx`**

```tsx
import { Link, useRouterState } from '@tanstack/react-router'
import { ChevronDown, Flame } from 'lucide-react'
import * as React from 'react'
import { displayRole } from '#/lib/format'
import { isGroup } from '#/lib/navigation'
import type { NavGroup, NavItem, NavSection } from '#/lib/navigation'
import { levelFor } from '#/server/levels'
import type { AuthCtx } from '#/server/roles'
import { Avatar } from './Avatar'

const linkCls =
  'flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-neutral-400 hover:bg-neutral-800 hover:text-neutral-50 [&.active]:bg-brand [&.active]:text-white'

export function Sidebar({ sections, me, totalPoints }: { sections: Array<NavSection>; me: Pick<AuthCtx, 'name' | 'role' | 'memberships'>; totalPoints: number }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const [open, setOpen] = React.useState<Record<string, boolean>>({})
  const isOpen = (g: NavGroup) => open[g.label] ?? g.children.some((c) => pathname.startsWith(c.to))
  const level = levelFor(totalPoints)

  return (
    <aside className="flex flex-col gap-4 border-b border-neutral-800 bg-neutral-900 px-4 py-4 lg:sticky lg:top-0 lg:h-screen lg:w-[248px] lg:shrink-0 lg:border-r lg:border-b-0 lg:px-4 lg:py-5">
      <Link to="/" className="flex items-center gap-2 px-2">
        <span className="tile-green h-8 w-8 rounded-lg"><Flame className="h-4 w-4 fill-current" /></span>
        <span className="text-lg font-bold tracking-tight">Task Gaming</span>
      </Link>

      <nav className="-mx-4 flex gap-1 overflow-x-auto px-4 lg:mx-0 lg:flex-1 lg:flex-col lg:gap-5 lg:overflow-y-auto lg:overflow-x-visible lg:px-0">
        {sections.map((section) => (
          <div key={section.label} className="flex gap-1 lg:flex-col">
            <div className="hidden px-3 pb-1 text-[11px] font-semibold tracking-wider text-neutral-500 uppercase lg:block">{section.label}</div>
            {section.items.map((item) => (isGroup(item) ? <Group key={item.label} group={item} open={isOpen(item)} onToggle={() => setOpen((o) => ({ ...o, [item.label]: !isOpen(item) }))} /> : <ItemLink key={item.to} item={item} />))}
          </div>
        ))}
      </nav>

      <div className="hidden items-center gap-3 rounded-2xl border border-neutral-800 bg-neutral-950/60 p-3 lg:flex">
        <Avatar name={me.name} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{me.name}</div>
          <div className="truncate text-xs text-neutral-400">{displayRole(me)}</div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-neutral-800" title={`Nível ${level.level} · ${level.name}`}>
            <div className="h-full rounded-full bg-xp-400" style={{ width: `${level.pct}%` }} />
          </div>
          <div className="mt-1 text-[11px] text-neutral-500">Nível {level.level} · {level.next ? `${totalPoints - level.min}/${level.next - level.min} pts` : `${totalPoints} pts`}</div>
        </div>
      </div>
    </aside>
  )
}

function ItemLink({ item, nested = false }: { item: NavItem; nested?: boolean }) {
  return (
    <Link to={item.to} activeOptions={{ exact: item.to === '/' }} className={`${linkCls} ${nested ? 'lg:ml-3 lg:py-1.5 lg:text-[13px]' : ''}`}>
      <item.icon className="h-4 w-4" />
      {item.label}
    </Link>
  )
}

/** No desktop o pai abre e fecha o grupo; no celular (nav horizontal) o pai some e os filhos aparecem. */
function Group({ group, open, onToggle }: { group: NavGroup; open: boolean; onToggle: () => void }) {
  return (
    <>
      <button type="button" onClick={onToggle} aria-expanded={open} className={`${linkCls} hidden w-full lg:flex`}>
        <group.icon className="h-4 w-4" />
        {group.label}
        <ChevronDown className={`ml-auto h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {group.children.map((child) => (
        <div key={child.to} className={open ? '' : 'lg:hidden'}>
          <ItemLink item={child} nested />
        </div>
      ))}
    </>
  )
}
```

(Se `levelFor(...).pct`, `.min`, `.next`, `.name`, `.level` já são os campos usados hoje no `Shell`, manter; se o typecheck acusar, ajustar para os campos reais lendo `src/server/levels.ts`.)

- [ ] **Step 3: `src/components/Shell.tsx`**

Reescrever o componente para compor as peças. Conservar `signOut`, `stopImpersonating`, o aviso de impersonação e o `Hud`; trocar o layout e a largura:

```tsx
import { Outlet, useMatches, useRouter } from '@tanstack/react-router'
// ...
import { DEFAULT_PAGE_WIDTH } from '#/lib/page-width'
import { buildNav } from '#/lib/navigation'
import { PageContainer } from './PageContainer'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'

export function Shell({ children }: { children: React.ReactNode }) {
  const { me, active, totalPoints, attention } = appRoute.useRouteContext()
  const router = useRouter()
  const width = useMatches({ select: (matches) => [...matches].reverse().find((m) => m.staticData.pageWidth)?.staticData.pageWidth ?? DEFAULT_PAGE_WIDTH })
  // signOut e stopImpersonating iguais aos de hoje

  return (
    <div className="min-h-screen lg:flex">
      <Sidebar sections={buildNav(me)} me={me} totalPoints={totalPoints} />
      <div className="min-w-0 flex-1">
        <Topbar me={me} attention={attention} onSignOut={signOut} />
        <main className="px-4 py-6 pb-28 lg:px-8">
          {me.impersonatedBy && (/* aviso de impersonação, igual ao de hoje */)}
          <PageContainer width={width}>{children}</PageContainer>
        </main>
      </div>
      {active && <Hud task={active} />}
    </div>
  )
}
```

No `Hud`, trocar `lg:left-[calc(15rem+1rem)]` por `lg:left-[calc(248px+1rem)]`. Remover do arquivo o `nav`, `settings`, `Path`, `Item`, `linkCls` e os imports de ícones que deixaram de ser usados (o lint acusa).

- [ ] **Step 4: Verificar**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: tudo verde (1198 testes mais os novos).

- [ ] **Step 5: Conferir no navegador**

Abrir `http://localhost:3010/` (admin `ana@acme.com`, senha `demo-1234`) em claro e em escuro, nas larguras 1860, 1440 e 390. Esperado: seções rotuladas, item ativo em pílula azul-violeta, cartão de nível no rodapé, topbar fixa; nenhuma tela quebrada nas rotas: `/`, `/challenges`, `/board`, `/pipeline`, `/leads`, `/team`, `/settings/users`, `/tasks/new`. Salvar capturas em `.playwright-mcp/onda1-*.png`.

- [ ] **Step 6: Commit**

```bash
git add src/components/Shell.tsx src/components/Sidebar.tsx src/components/Topbar.tsx
git commit -m "Casca nova: barra lateral em seções, topbar com espaço de busca e largura por rota"
```

---

# Onda 2: pipeline

### Task 7: Situação do negócio

**Files:**
- Create: `src/lib/deal-status.ts`
- Test: `src/lib/deal-status.test.ts`

**Interfaces:**
- Produces: `type DealStatus = 'overdue' | 'soon' | 'on_track'`; `dealStatus(expectedCloseDate: string | null, stageKind: StageKind, today: string): DealStatus | null` (datas `YYYY-MM-DD`); `DEAL_STATUS_LABEL: Record<DealStatus, string>`; `localToday(now?: Date): string` (data local `YYYY-MM-DD`).

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, expect, it } from 'vitest'
import { DEAL_STATUS_LABEL, dealStatus, localToday } from './deal-status'

const today = '2026-11-10'

describe('dealStatus', () => {
  it('sem previsão ou com a etapa fechada não há selo', () => {
    expect(dealStatus(null, 'open', today)).toBeNull()
    expect(dealStatus('2026-11-01', 'won', today)).toBeNull()
    expect(dealStatus('2026-11-01', 'lost', today)).toBeNull()
  })

  it('data passada está atrasada', () => {
    expect(dealStatus('2026-11-09', 'open', today)).toBe('overdue')
  })

  it('vence hoje e até 7 dias à frente é "vence logo"', () => {
    expect(dealStatus('2026-11-10', 'open', today)).toBe('soon')
    expect(dealStatus('2026-11-17', 'open', today)).toBe('soon')
  })

  it('depois de 7 dias está no prazo', () => {
    expect(dealStatus('2026-11-18', 'open', today)).toBe('on_track')
  })

  it('a virada de mês e de ano conta os dias certos', () => {
    expect(dealStatus('2027-01-03', 'open', '2026-12-28')).toBe('soon')
    expect(dealStatus('2027-01-05', 'open', '2026-12-28')).toBe('on_track')
  })
})

describe('textos e data local', () => {
  it('cada situação tem um rótulo', () => {
    expect(DEAL_STATUS_LABEL).toEqual({ overdue: 'Atrasada', soon: 'Vence logo', on_track: 'No prazo' })
  })

  it('localToday usa o calendário local, não o UTC', () => {
    expect(localToday(new Date(2026, 10, 10, 23, 30))).toBe('2026-11-10')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/lib/deal-status.test.ts`
Expected: FAIL (módulo não existe)

- [ ] **Step 3: Implementar `src/lib/deal-status.ts`**

```ts
import type { StageKind } from '#/db/schema'
import { MS_PER_DAY } from './goals'

export type DealStatus = 'overdue' | 'soon' | 'on_track'

const SOON_DAYS = 7

export const DEAL_STATUS_LABEL: Record<DealStatus, string> = { overdue: 'Atrasada', soon: 'Vence logo', on_track: 'No prazo' }

const pad = (n: number) => String(n).padStart(2, '0')

export const localToday = (now = new Date()) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`

/** Datas `YYYY-MM-DD` viram meia-noite UTC dos dois lados, então a diferença é de dias inteiros. */
export function dealStatus(expectedCloseDate: string | null, stageKind: StageKind, today: string): DealStatus | null {
  if (stageKind !== 'open' || !expectedCloseDate) return null
  const days = (Date.parse(expectedCloseDate) - Date.parse(today)) / MS_PER_DAY
  if (days < 0) return 'overdue'
  return days <= SOON_DAYS ? 'soon' : 'on_track'
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run src/lib/deal-status.test.ts && pnpm typecheck`
Expected: PASS (7 testes)

- [ ] **Step 5: Commit**

```bash
git add src/lib/deal-status.ts src/lib/deal-status.test.ts
git commit -m "Situação do negócio derivada da previsão de fechamento"
```

### Task 8: Busca de negócio e indicadores do pipeline

**Files:**
- Create: `src/lib/deal-search.ts`, `src/lib/pipeline-kpis.ts`
- Test: `src/lib/deal-search.test.ts`, `src/lib/pipeline-kpis.test.ts`

**Interfaces:**
- Produces:
  - `matchesDeal(card: { title: string; leadName: string }, query: string): boolean` (sem acento, sem diferenciar caixa; consulta vazia casa tudo)
  - `type KpiColumn = { kind: StageKind; amountCents: number; weightedCents: number; opportunities: ReadonlyArray<unknown> }`
  - `pipelineKpis(columns: ReadonlyArray<KpiColumn>, funnel: { winRate: number | null; averageCycleDays: number | null }): { openCents: number; forecastCents: number; openCount: number; winRate: number | null; averageCycleDays: number | null }`

- [ ] **Step 1: Escrever os testes que falham**

`src/lib/deal-search.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { matchesDeal } from './deal-search'

const deal = { title: 'Renovação anual', leadName: 'Mariana Souza' }

describe('matchesDeal', () => {
  it('consulta vazia ou só espaços casa tudo', () => {
    expect(matchesDeal(deal, '')).toBe(true)
    expect(matchesDeal(deal, '   ')).toBe(true)
  })

  it('casa por título ou por lead, sem diferenciar caixa nem acento', () => {
    expect(matchesDeal(deal, 'renovacao')).toBe(true)
    expect(matchesDeal(deal, 'MARIANA')).toBe(true)
    expect(matchesDeal(deal, 'souza anual')).toBe(false)
  })

  it('não casa o que não está no título nem no lead', () => {
    expect(matchesDeal(deal, 'contrato')).toBe(false)
  })
})
```

`src/lib/pipeline-kpis.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { pipelineKpis } from './pipeline-kpis'

const column = (kind: 'open' | 'won' | 'lost', amountCents: number, weightedCents: number, count: number) => ({
  kind,
  amountCents,
  weightedCents,
  opportunities: Array.from({ length: count }),
})

describe('pipelineKpis', () => {
  it('soma só as etapas abertas', () => {
    const kpis = pipelineKpis([column('open', 1000, 250, 2), column('open', 500, 250, 1), column('won', 9000, 9000, 4), column('lost', 700, 0, 1)], { winRate: 0.8, averageCycleDays: 12 })

    expect(kpis).toEqual({ openCents: 1500, forecastCents: 500, openCount: 3, winRate: 0.8, averageCycleDays: 12 })
  })

  it('sem etapas abertas tudo é zero e a taxa e o ciclo seguem do funil', () => {
    expect(pipelineKpis([column('won', 10, 10, 1)], { winRate: null, averageCycleDays: null })).toEqual({ openCents: 0, forecastCents: 0, openCount: 0, winRate: null, averageCycleDays: null })
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/lib/deal-search.test.ts src/lib/pipeline-kpis.test.ts`
Expected: FAIL (módulos não existem)

- [ ] **Step 3: Implementar**

`src/lib/deal-search.ts`:

```ts
const normalize = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

export function matchesDeal(card: { title: string; leadName: string }, query: string) {
  const needle = normalize(query.trim())
  return needle === '' || normalize(`${card.title} ${card.leadName}`).includes(needle)
}
```

`src/lib/pipeline-kpis.ts`:

```ts
import type { StageKind } from '#/db/schema'

export type KpiColumn = { kind: StageKind; amountCents: number; weightedCents: number; opportunities: ReadonlyArray<unknown> }

export function pipelineKpis(columns: ReadonlyArray<KpiColumn>, funnel: { winRate: number | null; averageCycleDays: number | null }) {
  const open = columns.filter((c) => c.kind === 'open')
  return {
    openCents: open.reduce((sum, c) => sum + c.amountCents, 0),
    forecastCents: open.reduce((sum, c) => sum + c.weightedCents, 0),
    openCount: open.reduce((sum, c) => sum + c.opportunities.length, 0),
    winRate: funnel.winRate,
    averageCycleDays: funnel.averageCycleDays,
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run src/lib/deal-search.test.ts src/lib/pipeline-kpis.test.ts && pnpm typecheck`
Expected: PASS (5 testes)

- [ ] **Step 5: Commit**

```bash
git add src/lib/deal-search.ts src/lib/deal-search.test.ts src/lib/pipeline-kpis.ts src/lib/pipeline-kpis.test.ts
git commit -m "Busca de negócio e indicadores do pipeline como funções puras"
```

### Task 9: Peças de interface: busca, seletor em pílula e indicador

**Files:**
- Create: `src/components/SearchField.tsx`, `src/components/FilterSelect.tsx`, `src/components/KpiCard.tsx`

**Interfaces:**
- Produces:
  - `<SearchField value onChange placeholder? />`
  - `<FilterSelect label icon value onChange>{<option>...}</FilterSelect>` (`icon: LucideIcon`, `onChange: (value: string) => void`)
  - `<KpiCard icon label value hint? />` (`value: string`)

- [ ] **Step 1: `SearchField.tsx`**

```tsx
import { Search } from 'lucide-react'

export function SearchField({ value, onChange, placeholder = 'Buscar…' }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <label className="relative block w-full max-w-md">
      <span className="sr-only">{placeholder}</span>
      <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-neutral-500" />
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="h-10 rounded-xl bg-neutral-900 pl-9" />
    </label>
  )
}
```

- [ ] **Step 2: `FilterSelect.tsx`**

```tsx
import type { LucideIcon } from 'lucide-react'
import { ChevronDown } from 'lucide-react'

type Props = { label: string; icon: LucideIcon; value: string; onChange: (value: string) => void; children: React.ReactNode }

export function FilterSelect({ label, icon: Icon, value, onChange, children }: Props) {
  return (
    <label className="relative inline-flex items-center">
      <Icon className="pointer-events-none absolute left-3 h-4 w-4 text-neutral-500" />
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className="h-10 w-auto appearance-none rounded-xl bg-neutral-900 py-0 pr-9 pl-9 font-medium">
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 h-4 w-4 text-neutral-500" />
    </label>
  )
}
```

- [ ] **Step 3: `KpiCard.tsx`**

```tsx
import type { LucideIcon } from 'lucide-react'

export function KpiCard({ icon: Icon, label, value, hint }: { icon: LucideIcon; label: string; value: string; hint?: string }) {
  return (
    <div className="card flex flex-col gap-2">
      <div className="flex items-center gap-2 text-sm text-neutral-400">
        <Icon className="h-4 w-4" />
        {label}
      </div>
      <div className="text-[28px] leading-8 font-bold tracking-tight tabular-nums">{value}</div>
      {hint && <div className="text-xs text-neutral-500">{hint}</div>}
    </div>
  )
}
```

- [ ] **Step 4: Verificar**

Run: `pnpm typecheck && pnpm lint`
Expected: limpos (estes componentes só ganham verificação visual na Task 11).

- [ ] **Step 5: Commit**

```bash
git add src/components/SearchField.tsx src/components/FilterSelect.tsx src/components/KpiCard.tsx
git commit -m "Peças de interface: busca, seletor em pílula e indicador"
```

### Task 10: Colunas, cartões e altura do kanban do pipeline

**Files:**
- Modify: `src/components/pipeline/Column.tsx`, `src/components/pipeline/Card.tsx`, `src/components/pipeline/Board.tsx`

**Interfaces:**
- Consumes: `dealStatus`, `DEAL_STATUS_LABEL`, `localToday` (Task 7)
- Produces: `<PipelineBoard columns onMove />` com colunas de largura igual; `cards` já vêm filtrados pela busca (a rota filtra antes de passar `columns`).

- [ ] **Step 1: Cabeçalho da coluna em `Column.tsx`**

Trocar o contêiner e o cabeçalho (a lógica de `useDroppable`, `SortableContext` e os totais não muda):

```tsx
const KIND_DOT = { open: 'bg-brand-ring', won: 'bg-xp-400', lost: 'bg-rose-400' } as const

export function PipelineColumn({ stage, cards }: { stage: StageColumn; cards: Array<OpportunityCardData> }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id })
  const amountCents = cards.reduce((sum, c) => sum + c.amountCents, 0)
  return (
    <section className={`flex h-full min-w-[280px] flex-1 flex-col rounded-2xl border bg-neutral-950/60 p-2 ${isOver ? 'border-brand-ring' : 'border-neutral-800'}`}>
      <header className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <span className={`h-2 w-2 rounded-full ${KIND_DOT[stage.kind]}`} />
          {stage.name}
        </h2>
        <span className="text-xs text-neutral-400 tabular-nums">
          {cards.length} {cards.length === 1 ? 'negócio' : 'negócios'} · {formatCents(amountCents)}
        </span>
      </header>
      {stage.kind === 'open' && <div className="mb-2 px-1 text-xs text-neutral-500">Ponderado {formatCents(weightedAmount(amountCents, stage.probability))}</div>}
      <div ref={setNodeRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5">
        <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {cards.map((c) => <OpportunityCard key={c.id} card={c} stageKind={stage.kind} />)}
        </SortableContext>
      </div>
    </section>
  )
}
```

(remover a constante `KIND_ACCENT` e o `min-h-[55vh] w-[260px]`.)

- [ ] **Step 2: Cartão com selo em `Card.tsx`**

Receber `stageKind` e mostrar o selo à direita do rodapé; manter o arrastar e o overlay inclinado:

```tsx
import { DEAL_STATUS_LABEL, dealStatus, localToday } from '#/lib/deal-status'
import type { DealStatus } from '#/lib/deal-status'
import type { StageKind } from '#/db/schema'

const STATUS_CLS: Record<DealStatus, string> = {
  overdue: 'border-rose-900/50 bg-rose-950/40 text-rose-400',
  soon: 'border-amber-800/50 bg-amber-950/40 text-amber-300',
  on_track: 'border-brand-ring/30 bg-brand-soft text-brand-ink',
}

export function OpportunityCard({ card, stageKind, overlay = false }: { card: OpportunityCardData; stageKind: StageKind; overlay?: boolean }) {
  const status = dealStatus(card.expectedCloseDate, stageKind, localToday())
  // ...useSortable e style como hoje
  return (
    <div /* ref, style, attributes, listeners */ className={`rounded-xl border border-neutral-800 bg-neutral-900 p-3 shadow-[0_1px_2px_rgb(20_22_50/0.04)] hover:border-neutral-700 ${overlay ? 'rotate-2 shadow-2xl' : ''} ${card.canWrite ? 'cursor-grab active:cursor-grabbing' : ''}`}>
      <Link /* igual a hoje */ className="block text-sm leading-snug font-semibold text-neutral-50 hover:underline">{card.title}</Link>
      <div className="mt-0.5 truncate text-xs text-neutral-400">{card.leadName}</div>
      <div className="mt-3 flex items-center gap-3 text-xs text-neutral-300 tabular-nums">
        <span className="font-semibold text-neutral-50">{formatCents(card.amountCents)}</span>
        {card.expectedCloseDate && (
          <span className="flex items-center gap-1 text-neutral-400">
            <CalendarDays className="h-3.5 w-3.5" /> {card.expectedCloseDate.slice(8)}/{card.expectedCloseDate.slice(5, 7)}/{card.expectedCloseDate.slice(0, 4)}
          </span>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-neutral-800 pt-2.5">
        {card.ownerName ? (
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-neutral-300">
            <Avatar name={card.ownerName} size="sm" />
            <span className="truncate">{card.ownerName}</span>
          </span>
        ) : (
          <span className="text-xs text-neutral-500 italic">Sem dono</span>
        )}
        {status && <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_CLS[status]}`}>{DEAL_STATUS_LABEL[status]}</span>}
      </div>
    </div>
  )
}
```

(o valor deixa de ser verde: o verde fica para pontos e "no prazo" semântico; "no prazo" usa `brand-soft` aqui por ser informativo, não sucesso. Os testes e a spec definem o rótulo, não a cor.)

- [ ] **Step 3: Contêiner do kanban em `Board.tsx`**

Trocar a classe do contêiner das colunas e passar `stageKind` ao overlay:

```tsx
      <div className="flex h-[max(28rem,calc(100dvh-21rem))] gap-3 overflow-x-auto pb-2 select-none">
        {columns.map((stage) => <PipelineColumn key={stage.id} stage={stage} cards={items[stage.id] ?? []} />)}
      </div>
      <DragOverlay>{active ? <OpportunityCard card={active} stageKind={columns.find((c) => c.id === active.stageId)?.kind ?? 'open'} overlay /> : null}</DragOverlay>
```

(remover `-mx-4 px-4`, que existiam por causa do contêiner de 1180px.)

- [ ] **Step 4: Verificar**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: verdes.

- [ ] **Step 5: Commit**

```bash
git add src/components/pipeline/Column.tsx src/components/pipeline/Card.tsx src/components/pipeline/Board.tsx
git commit -m "Kanban do pipeline: colunas iguais, cabeçalho em pílula e selo de situação"
```

### Task 11: Montagem da tela de pipeline

**Files:**
- Create: `src/components/pipeline/PipelineKpis.tsx`
- Modify: `src/routes/_app/pipeline.tsx`, `src/components/pipeline/FunnelPanel.tsx`

**Interfaces:**
- Consumes: `pipelineKpis` (Task 8), `KpiCard`/`SearchField`/`FilterSelect` (Task 9), `matchesDeal` (Task 8), `PageHeader` (Task 4), `TopbarSlot` (Task 6)

- [ ] **Step 1: `PipelineKpis.tsx`**

```tsx
import { Briefcase, Coins, Hourglass, Target, Trophy } from 'lucide-react'
import { formatCents, formatRate } from '#/lib/pipeline'
import { pipelineKpis } from '#/lib/pipeline-kpis'
import type { StageColumn } from './Board'
import { KpiCard } from '../KpiCard'

const formatDays = (days: number | null) => (days === null ? '—' : `${Math.round(days)} dias`)

export function PipelineKpis({ columns, funnel, periodDays }: { columns: Array<StageColumn>; funnel: { winRate: number | null; averageCycleDays: number | null }; periodDays: number }) {
  const kpis = pipelineKpis(columns, funnel)
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <KpiCard icon={Coins} label="Pipeline aberto" value={formatCents(kpis.openCents)} />
      <KpiCard icon={Target} label="Forecast ponderado" value={formatCents(kpis.forecastCents)} />
      <KpiCard icon={Briefcase} label="Negócios abertos" value={String(kpis.openCount)} />
      <KpiCard icon={Trophy} label="Taxa de ganho" value={formatRate(kpis.winRate)} hint={`Últimos ${periodDays} dias`} />
      <KpiCard icon={Hourglass} label="Ciclo médio das ganhas" value={formatDays(kpis.averageCycleDays)} />
    </div>
  )
}
```

- [ ] **Step 2: `FunnelPanel.tsx` só com a conversão**

Remover o bloco `grid` com os quatro `StatTile`, os imports `Coins/Hourglass/Target/Trophy`, `StatTile`, `formatDays`, `open/openAmount/forecast` e a prop `columns`; a assinatura vira `FunnelPanel({ funnel, periodDays })` e o `<section>` contém apenas o cartão "Conversão entre etapas".

- [ ] **Step 3: `src/routes/_app/pipeline.tsx`**

Declarar a largura e remontar o cabeçalho, os filtros e a ordem dos blocos:

```tsx
export const Route = createFileRoute('/_app/pipeline')({
  staticData: { pageWidth: 'full' },
  // ...validateSearch, loaderDeps, loader e component como hoje
})
```

No componente `Pipeline`: estado da busca `const [query, setQuery] = React.useState('')`; cartões filtrados:

```tsx
  const visible = React.useMemo(() => columns.map((c) => ({ ...c, opportunities: c.opportunities.filter((o) => matchesDeal(o, query)) })), [columns, query])
```

Retorno:

```tsx
    <div className="space-y-5">
      <TopbarSlot>
        <SearchField value={query} onChange={setQuery} placeholder="Buscar negócio ou lead…" />
      </TopbarSlot>
      <PageHeader title="Pipeline" subtitle={pipelines.find((p) => p.id === pipelineId)?.name} />
      <PipelineKpis columns={columns} funnel={funnel} periodDays={search.periodDays} />
      <div className="flex flex-wrap items-center gap-2">
        {pipelines.length > 1 && (
          <FilterSelect label="Pipeline" icon={Funnel} value={pipelineId} onChange={(v) => set({ pipelineId: v })}>
            {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </FilterSelect>
        )}
        {filters.teams.length > 0 && (
          <FilterSelect label="Equipe" icon={UsersRound} value={search.teamId ?? ''} onChange={(v) => set({ teamId: v || undefined, ownerId: undefined })}>
            <option value="">Todas as equipes</option>
            {filters.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </FilterSelect>
        )}
        <FilterSelect label="Dono" icon={User} value={search.ownerId ?? ''} onChange={(v) => set({ ownerId: v || undefined })}>
          <option value="">Todos os donos</option>
          {filters.owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </FilterSelect>
        <FilterSelect label="Período do funil" icon={CalendarRange} value={String(search.periodDays)} onChange={(v) => set({ periodDays: Number(v) })}>
          {PERIOD_OPTIONS.map((d) => <option key={d} value={d}>Últimos {d} dias</option>)}
        </FilterSelect>
        {(search.teamId || search.ownerId || search.pipelineId || query) && (
          <button type="button" className="btn-ghost px-3 py-2 text-xs" onClick={() => { setQuery(''); navigate({ search: { periodDays: search.periodDays } }) }}>
            Limpar filtros
          </button>
        )}
      </div>
      {error && <p className="rounded-xl border border-rose-900/50 bg-rose-950/40 px-3 py-2 text-sm text-rose-400">{error}</p>}
      <PipelineBoard columns={visible} onMove={onMove} />
      <FunnelPanel funnel={funnel} periodDays={search.periodDays} />
      {/* LostReasonModal igual a hoje */}
    </div>
```

(imports novos: `Funnel, UsersRound, User, CalendarRange` de `lucide-react`; `SearchField`, `FilterSelect`, `PageHeader`, `TopbarSlot`, `PipelineKpis`, `matchesDeal`.)

- [ ] **Step 4: Verificar**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: verdes.

- [ ] **Step 5: Conferir no navegador**

`http://localhost:3010/pipeline` como admin, em claro e escuro, larguras 1860, 1440 e 390: indicadores no topo; kanban ocupando a largura inteira com colunas iguais; busca na topbar filtra os cartões; arrastar um cartão entre colunas funciona e perder exige o motivo; selo de situação aparece nos cartões com previsão. Capturas em `.playwright-mcp/onda2-*.png`.

- [ ] **Step 6: Commit**

```bash
git add src/components/pipeline src/routes/_app/pipeline.tsx
git commit -m "Pipeline em largura total: indicadores no topo, filtros em pílula e busca na topbar"
```

---

# Onda 3: Hoje, Board, Leads, Equipe e Desafios

As quatro tarefas abaixo tocam arquivos disjuntos e podem rodar em paralelo. Todas usam `staticData: { pageWidth: ... }`, `PageHeader`, `KpiCard`, `FilterSelect`, `SearchField` e `TopbarSlot` das ondas anteriores; nenhuma cria regra nova de negócio. Em cada uma: ler o arquivo, preservar toda a lógica e os dados do loader, trocar só layout e classes, e fechar com typecheck, lint, testes, capturas em claro e escuro (1860, 1440, 390) e `npx impeccable detect src/`.

### Task 12: Hoje

**Files:** Modify `src/routes/_app/index.tsx` (e os componentes que ele usa em `src/components/` só para ajustar espaçamento e largura).

- [ ] Declarar `staticData: { pageWidth: 'wide' }`.
- [ ] Trocar a pilha vertical por uma grade: indicadores (`StatTile` atuais, em `grid-cols-2 lg:grid-cols-4`) → bloco de nível e meta (hero) → linha `grid gap-4 xl:grid-cols-12` com **Minha fila** (`xl:col-span-7`), **Desempenho** (`xl:col-span-5`) e abaixo **Equipe agora** + **Desafios** lado a lado → **Sua jornada** em largura total.
- [ ] Manter intactos os dados, o anel de meta, o "Dia livre" e os links. Os `tile-*` passam a ser chapados (Task 2).
- [ ] Commit: `git commit -m "Tela Hoje em grade, aproveitando a largura"`.

### Task 13: Board de tarefas (kanban)

**Files:** Modify `src/routes/_app/board.tsx`, `src/components/kanban/*` (`Card.tsx`, `Column.tsx`, `Board.tsx`).

- [ ] Declarar `staticData: { pageWidth: 'full' }`; usar `PageHeader`, busca da tarefa na `TopbarSlot` e os filtros atuais como `FilterSelect`.
- [ ] Colunas iguais com o mesmo cabeçalho em pílula da Task 10 (ponto de cor por status: pendente neutro, em andamento `brand-ring`, pausada âmbar, concluída verde) e altura `h-[max(28rem,calc(100dvh-14rem))]`.
- [ ] **Remover `border-l-4` do cartão** (`PRIORITY_BORDER`): a prioridade passa a ser um selo à direita no rodapé (`Alta` rosa, `Média` âmbar, `Baixa` neutro), no mesmo estilo do selo do pipeline. É o último achado do detector.
- [ ] Commit: `git commit -m "Board de tarefas em largura total e prioridade em selo"`.

### Task 14: Leads

**Files:** Modify `src/routes/_app/leads/index.tsx` (e `$leadId.tsx` só para `staticData`).

- [ ] Declarar `staticData: { pageWidth: 'full' }` na lista e `'wide'` no detalhe; `PageHeader` com as ações "Importar" e "Novo lead"; busca na `TopbarSlot`; filtros como `FilterSelect`.
- [ ] A lista vira uma tabela de cartão único (`card p-0 overflow-hidden`): cabeçalho cinza com os rótulos, linhas com avatar do dono, equipe, origem e status em selo; manter o botão "Assumir" com a regra `can(me, 'lead.write', l.teamId)` de hoje.
- [ ] Commit: `git commit -m "Lista de leads em tabela de largura total"`.

### Task 15: Equipe e Desafios

**Files:** Modify `src/routes/_app/team.tsx`, `src/routes/_app/challenges/index.tsx`, `src/components/ChallengeCard.tsx`.

- [ ] `team.tsx`: `pageWidth: 'wide'`; "Ativos agora", "Aguardando validação" e "Ranking" em grade de duas colunas a partir de `xl` (ranking à direita); manter os botões de aprovar e rejeitar com os rótulos acessíveis atuais.
- [ ] `challenges/index.tsx`: `pageWidth: 'wide'`; cartões em `grid gap-4 md:grid-cols-2 2xl:grid-cols-3`; `ChallengeCard` com borda e sombra do `.card` e o selo "Compartilhado" em `brand-soft`.
- [ ] Commit: `git commit -m "Equipe e Desafios aproveitando a largura"`.

---

# Onda 4: Configurações, detalhes, modais e revisão final

### Task 16: Configurações

**Files:** Modify `src/routes/_app/settings/*.tsx`, `src/routes/_app/teams/$teamId.tsx`.

- [ ] Cada página usa `PageHeader` (título e subtítulo que já existem como texto solto) e declara a largura: `users`, `audit`, `permissions` e `teams` em `'wide'` (tabelas e matrizes); `goals`, `pipeline/*`, `boards` e `teams/$teamId` em `'wide'` quando têm grade de cartões, `'narrow'` quando são formulário simples.
- [ ] Sem segunda navegação: o grupo Configurações da barra lateral já cumpre esse papel.
- [ ] Commit: `git commit -m "Configurações com cabeçalho padronizado e largura por página"`.

### Task 17: Detalhes, formulários e modais

**Files:** Modify as rotas restantes: `tasks/*`, `challenges/$challengeId.tsx`, `challenges/new.tsx`, `opportunities/$opportunityId.tsx`, `leads/import.tsx`, `profile.tsx`, `admin/tenants/*`, e `src/components/Modal.tsx`.

- [ ] Declarar `pageWidth` explícito em **toda** rota sem declaração: formulários e detalhes em `'narrow'`, listas de administração em `'wide'`. Conferir com `grep -L "pageWidth" src/routes/_app/**/*.tsx` que só restam layouts e arquivos que não são páginas.
- [ ] Remover `'standard'` e `DEFAULT_PAGE_WIDTH`: `pageWidth` passa a ser obrigatório na prática com o padrão `'wide'`. Ajustar `src/lib/page-width.ts`, o teste e o `Shell`, e apagar `standard` do tipo.
- [ ] `Modal.tsx`: cartão branco com raio 16 e a borda do `.card`, fundo escurecido do `dialog::backdrop` mantido.
- [ ] Commit: `git commit -m "Toda rota declara a largura; modais no novo visual"`.

### Task 18: Revisão final

- [ ] `npx -y impeccable detect src/` sem nenhum achado. Se houver, corrigir na origem (não suprimir).
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm db:generate` verdes.
- [ ] Capturas das rotas `/`, `/challenges`, `/board`, `/pipeline`, `/leads`, `/team`, `/settings/users`, `/settings/goals`, `/tasks/new` em claro e escuro nas larguras 1860, 1440 e 390, conferidas uma a uma por olho: nada cortado, nada sobreposto, nenhum texto ilegível. Salvar em `.playwright-mcp/final-*.png`.
- [ ] README: acrescentar duas linhas na seção "Telas" sobre o tema claro padrão e a largura total.
- [ ] Commit: `git commit -m "Revisão final do redesenho visual"`.

---

## Self-Review

- **Cobertura da spec:** tokens e contraste (Tasks 1-2); tema claro padrão (3); largura por rota e cabeçalho (4); barra lateral em seções e topbar com espaço de busca (5-6); indicadores no topo, busca, pílulas, kanban em largura total, selo de situação e conversão restilizada (7-11); Hoje, Board, Leads, Equipe e Desafios (12-15); Configurações, detalhes e modais (16-17); critérios de aceite do detector, capturas e suíte (18). O detector fecha em 0 achados: o gradiente violeta sai na Task 2 e a borda lateral na Task 13.
- **Placeholders:** as Tasks 12-17 descrevem layout e arquivos, e não trazem código completo de propósito: dependem de ler a tela existente, que o executor da tarefa tem de abrir de qualquer forma. As Tasks 1-11 trazem testes e código completos.
- **Consistência de tipos:** `PageWidth`/`pageWidthClass`/`DEFAULT_PAGE_WIDTH` (Task 4) usados em `PageContainer` e `Shell` (Task 6); `buildNav`/`isGroup`/`NavGroup` (Task 5) usados em `Sidebar` (Task 6); `dealStatus`/`DEAL_STATUS_LABEL`/`localToday` (Task 7) usados em `Card` (Task 10); `matchesDeal` e `pipelineKpis` (Task 8) usados na rota (Task 11); `OpportunityCard` ganha `stageKind` na Task 10 e é chamado com ele em `Column` e no overlay de `Board`.
