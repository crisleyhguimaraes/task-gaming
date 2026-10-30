import { Link } from '@tanstack/react-router'
import { Bell, CheckCheck } from 'lucide-react'
import * as React from 'react'
import { notificationMessage } from '#/lib/notifications'
import { getNotifications, markAllNotificationsRead, markNotificationRead } from '#/server/notifications'

type Inbox = Awaited<ReturnType<typeof getNotifications>>
type Item = Inbox['items'][number]

const POLL_INTERVAL_MS = 15_000
const MAX_BADGE = 99

const formatWhen = (date: Date | string) => new Date(date).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

/** Sino com contagem de não lidas e lista suspensa; atualiza por polling, como o feed da equipe. */
export function NotificationBell() {
  const [inbox, setInbox] = React.useState<Inbox>({ unread: 0, items: [] })
  const [open, setOpen] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const root = React.useRef<HTMLDivElement>(null)

  const refresh = React.useCallback(async (update?: () => Promise<unknown>) => {
    try {
      await update?.()
      setInbox(await getNotifications())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro')
    }
  }, [])

  React.useEffect(() => {
    refresh()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refresh()
    }, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [refresh])

  React.useEffect(() => {
    if (!open) return
    const closeOnOutsideClick = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const closeOnEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  function markRead(item: Item) {
    setOpen(false)
    if (!item.readAt) refresh(() => markNotificationRead({ data: { id: item.id } }))
  }

  const markAllRead = () => refresh(() => markAllNotificationsRead())

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={inbox.unread > 0 ? `Notificações, ${inbox.unread} não lidas` : 'Notificações'}
        className="relative flex h-11 w-11 items-center justify-center rounded-full border border-neutral-800 bg-neutral-900 text-neutral-300 shadow-sm hover:text-neutral-50"
      >
        <Bell className="h-5 w-5" />
        {inbox.unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-5 rounded-full bg-rose-500 px-1 text-center text-[11px] font-bold leading-5 text-white">
            {inbox.unread > MAX_BADGE ? `${MAX_BADGE}+` : inbox.unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute top-full right-0 z-30 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-neutral-800 bg-neutral-900 p-2 shadow-2xl shadow-black/30">
          <div className="flex items-center justify-between px-2 py-1.5">
            <h2 className="text-sm font-semibold">Notificações</h2>
            {inbox.unread > 0 && (
              <button type="button" onClick={markAllRead} className="flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-50">
                <CheckCheck className="h-3.5 w-3.5" /> Marcar todas como lidas
              </button>
            )}
          </div>
          {error && <p className="px-2 pb-1 text-xs text-rose-400">Não foi possível atualizar: {error}</p>}
          <ul className="max-h-96 space-y-1 overflow-y-auto">
            {inbox.items.map((item) => (
              <li key={item.id}>
                <NotificationRow item={item} onOpen={() => markRead(item)} />
              </li>
            ))}
            {inbox.items.length === 0 && <li className="px-2 py-4 text-center text-sm text-neutral-500">Nada por aqui.</li>}
          </ul>
        </div>
      )}
    </div>
  )
}

function NotificationRow({ item, onOpen }: { item: Item; onOpen: () => void }) {
  const className = `flex w-full items-start gap-2 rounded-xl px-2 py-2 text-left hover:bg-neutral-800 ${item.readAt ? 'text-neutral-400' : 'text-neutral-50'}`
  const content = (
    <>
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.readAt ? 'bg-transparent' : 'bg-xp-400'}`} aria-hidden />
      <span className="min-w-0">
        <span className="block text-sm">{notificationMessage(item.type, item.payload)}</span>
        <span className="block text-xs text-neutral-500">{formatWhen(item.createdAt)}</span>
      </span>
    </>
  )
  if (item.entityType !== 'task') {
    return <button type="button" onClick={onOpen} className={className}>{content}</button>
  }
  return (
    <Link to="/tasks/$taskId" params={{ taskId: item.entityId }} onClick={onOpen} className={className}>
      {content}
    </Link>
  )
}
