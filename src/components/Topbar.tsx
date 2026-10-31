import { Link } from '@tanstack/react-router'
import { ClipboardList, LogOut, Moon, SunMedium, UserCircle } from 'lucide-react'
import * as React from 'react'
import { createPortal } from 'react-dom'
import { displayRole } from '#/lib/format'
import type { Theme } from '#/lib/theme'
import { getTheme, setTheme } from '#/lib/theme'
import type { AuthCtx } from '#/server/roles'
import { Avatar } from './Avatar'
import { NotificationBell } from './NotificationBell'

export const TOPBAR_SLOT_ID = 'topbar-slot'

type Viewer = Pick<AuthCtx, 'name' | 'role' | 'memberships'>
type Attention = { pool: number; validation: number }

/** Leva os filhos para o espaço de busca da topbar; só existe no cliente, depois de montado. */
export function TopbarSlot({ children }: { children: React.ReactNode }) {
  const [target, setTarget] = React.useState<HTMLElement | null>(null)
  React.useEffect(() => setTarget(document.getElementById(TOPBAR_SLOT_ID)), [])
  return target ? createPortal(children, target) : null
}

export function Topbar({ me, attention, onSignOut }: { me: Viewer; attention: Attention; onSignOut: () => void }) {
  return (
    <div className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-neutral-800 bg-neutral-950/85 px-4 backdrop-blur lg:px-8">
      <div id={TOPBAR_SLOT_ID} className="min-w-0 flex-1" />
      <HeaderActions me={me} attention={attention} onSignOut={onSignOut} />
    </div>
  )
}

const roundBtn = 'relative flex h-11 w-11 items-center justify-center rounded-full border border-neutral-800 bg-neutral-900 text-neutral-300 shadow-sm hover:text-neutral-50'

/** Tema, sino de atenção e avatar com o menu do usuário. */
function HeaderActions({ me, attention, onSignOut }: { me: Viewer; attention: Attention; onSignOut: () => void }) {
  const [theme, setThemeState] = React.useState<Theme>('light')
  React.useEffect(() => setThemeState(getTheme()), [])
  const choose = (t: Theme) => {
    setTheme(t)
    setThemeState(t)
  }
  const alerts = attention.pool + attention.validation
  const alertText = [
    attention.pool > 0 ? `${attention.pool} no pool da equipe` : null,
    attention.validation > 0 ? `${attention.validation} aguardando validação` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="flex items-center justify-end gap-2">
      <button type="button" onClick={() => choose(theme === 'dark' ? 'light' : 'dark')} className={roundBtn} title={theme === 'dark' ? 'Mudar para claro' : 'Mudar para escuro'}>
        {theme === 'dark' ? <SunMedium className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
      </button>
      <NotificationBell />
      <Link to="/team" className={roundBtn} title={alertText || 'Nada pendente'}>
        <ClipboardList className="h-5 w-5" />
        {alerts > 0 && <span className="absolute top-2 right-2.5 h-2.5 w-2.5 rounded-full border-2 border-neutral-900 bg-rose-500" />}
      </Link>
      <details className="relative">
        <summary className="flex cursor-pointer list-none [&::-webkit-details-marker]:hidden">
          <span className="relative">
            <Avatar name={me.name} size="lg" />
            <span className="absolute right-0 bottom-0 h-3 w-3 rounded-full border-2 border-neutral-950 bg-xp-400" title="Online" />
          </span>
        </summary>
        <div className="absolute top-full right-0 z-30 mt-2 w-64 rounded-2xl border border-neutral-800 bg-neutral-900 p-2 shadow-2xl shadow-black/30">
          <div className="flex items-center gap-3 px-2 py-2">
            <Avatar name={me.name} />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{me.name}</div>
              <div className="truncate text-xs text-neutral-400">{displayRole(me)}</div>
            </div>
          </div>
          <div className="my-1 border-t border-neutral-800" />
          <Link to="/profile" className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-800 hover:text-neutral-50" onClick={(e) => e.currentTarget.closest('details')?.removeAttribute('open')}>
            <UserCircle className="h-4 w-4" /> Meu perfil
          </Link>
          <div className="px-3 py-2">
            <div className="mb-1.5 text-xs text-neutral-400">Tema</div>
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-neutral-950/60 p-1 text-xs font-medium">
              <button type="button" onClick={() => choose('dark')} className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 ${theme === 'dark' ? 'bg-neutral-800 text-neutral-50' : 'text-neutral-400'}`}>
                <Moon className="h-3.5 w-3.5" /> Escuro
              </button>
              <button type="button" onClick={() => choose('light')} className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 ${theme === 'light' ? 'bg-neutral-800 text-neutral-50' : 'text-neutral-400'}`}>
                <SunMedium className="h-3.5 w-3.5" /> Claro
              </button>
            </div>
          </div>
          <div className="my-1 border-t border-neutral-800" />
          <button onClick={onSignOut} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-800 hover:text-neutral-50">
            <LogOut className="h-4 w-4" /> Sair
          </button>
        </div>
      </details>
    </div>
  )
}
