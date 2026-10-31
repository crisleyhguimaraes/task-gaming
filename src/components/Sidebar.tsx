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
        <span className="tile-green h-8 w-8 rounded-lg">
          <Flame className="h-4 w-4 fill-current" />
        </span>
        <span className="text-lg font-bold tracking-tight">Task Gaming</span>
      </Link>

      <nav className="-mx-4 flex items-center gap-1 overflow-x-auto px-4 lg:mx-0 lg:items-stretch lg:flex-1 lg:flex-col lg:gap-5 lg:overflow-x-visible lg:overflow-y-auto lg:px-0">
        {sections.map((section) => (
          <div key={section.label} className="flex items-center gap-1 lg:flex-col lg:items-stretch">
            <div className="hidden px-3 pb-1 text-[11px] font-semibold tracking-wider text-neutral-500 uppercase lg:block">{section.label}</div>
            {section.items.map((item) =>
              isGroup(item) ? (
                <Group key={item.label} group={item} open={isOpen(item)} onToggle={() => setOpen((o) => ({ ...o, [item.label]: !isOpen(item) }))} />
              ) : (
                <ItemLink key={item.to} item={item} />
              ),
            )}
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
          <div className="mt-1 text-[11px] text-neutral-500">
            Nível {level.level} · {level.next ? `${totalPoints - level.min}/${level.next - level.min} pts` : `${totalPoints} pts`}
          </div>
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
