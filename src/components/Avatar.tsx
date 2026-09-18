const GRADIENTS = [
  'from-xp-400 to-teal-500',
  'from-cyan-400 to-sky-500',
  'from-violet-400 to-indigo-500',
  'from-pink-400 to-rose-500',
  'from-amber-300 to-orange-500',
]

const hash = (s: string) => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7)

/** Iniciais num círculo com gradiente estável por nome (sem fotos no sistema). */
export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const initials = name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('')
  const cls = { sm: 'h-7 w-7 text-[10px]', md: 'h-9 w-9 text-xs', lg: 'h-12 w-12 text-sm', xl: 'h-20 w-20 text-2xl' }[size]
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br font-bold text-white ${GRADIENTS[hash(name) % GRADIENTS.length]} ${cls}`} aria-hidden>
      {initials}
    </span>
  )
}
