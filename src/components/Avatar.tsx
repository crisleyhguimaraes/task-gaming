const FILLS = ['bg-brand', 'bg-emerald-700', 'bg-amber-700', 'bg-rose-600', 'bg-sky-700', 'bg-teal-700']

const hash = (s: string) => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7)

/** Iniciais num círculo de cor chapada, estável por nome (sem fotos no sistema). */
export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const initials = name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('')
  const cls = { sm: 'h-7 w-7 text-[10px]', md: 'h-9 w-9 text-xs', lg: 'h-12 w-12 text-sm', xl: 'h-20 w-20 text-2xl' }[size]
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white ${FILLS[hash(name) % FILLS.length]} ${cls}`} aria-hidden>
      {initials}
    </span>
  )
}
