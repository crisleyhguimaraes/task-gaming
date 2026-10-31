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
  const children = candidates.filter((c) => c.show).map(({ to, label, icon }) => ({ to, label, icon }))
  const first = children[0]
  return first ? { to: first.to, label: 'Configurações', icon: Settings, children } : null
}

export function buildNav(me: Viewer): Array<NavSection> {
  const settings = settingsGroup(me)
  const system: Array<NavItem | NavGroup> = [
    ...(settings ? [settings] : []),
    ...(me.role === 'SUPER_ADMIN' ? [{ to: '/admin/tenants' as const, label: 'Tenants', icon: Building2 }] : []),
  ]
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
