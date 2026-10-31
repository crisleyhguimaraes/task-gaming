import { CheckCircle2, Flame, Pause, Play } from 'lucide-react'
import { fmtClock } from '#/lib/format'
import { useElapsed } from '#/lib/useElapsed'
import { Ring } from './Ring'

export type PlayerTask = {
  id: string
  title: string
  description: string | null
  basePoints: number
  estimatedSeconds: number
  status: 'pending' | 'in_progress' | 'paused' | 'finished' | 'cancelled'
  accumulatedSeconds: number
  activeStartedAt: string | null
  cap: number
  assigneeName: string | null
}

type Props = {
  task: PlayerTask
  busy: boolean
  /** Quem só acompanha (o líder diante da tentativa de desafio de outra pessoa) não pausa nem conclui. */
  readOnly?: boolean
  onStart: () => void
  onPause: () => void
  onFinish: () => void
}

/** O anel é o protagonista: cronômetro dentro, progresso vs. estimado ao redor (vermelho ao estourar). */
export function TaskPlayer({ task, busy, readOnly = false, onStart, onPause, onFinish }: Props) {
  const { seconds, interrupted } = useElapsed(task.accumulatedSeconds, task.activeStartedAt, task.cap)
  const running = task.status === 'in_progress' && task.activeStartedAt !== null
  const ratio = seconds / task.estimatedSeconds
  const over = ratio > 1
  const pace =
    ratio < 0.8
      ? { label: 'Ritmo forte (+15%)', cls: 'text-xp-400 bg-xp-950/50' }
      : ratio <= 1.1
        ? { label: 'No ritmo', cls: 'text-amber-300 bg-amber-950/40' }
        : ratio <= 1.5
          ? { label: 'Acima do estimado', cls: 'text-orange-300 bg-orange-950/40' }
          : { label: 'Estourado (penalidade)', cls: 'text-rose-300 bg-rose-950/40' }

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-8 py-4 text-center select-none">
      <div className="space-y-2">
        <span className="inline-flex items-center gap-1 rounded-full bg-xp-950/50 px-3 py-1 text-sm font-semibold text-xp-400">
          <Flame className="h-4 w-4 fill-current" /> {task.basePoints} pts
        </span>
        <h1 className="text-2xl leading-snug font-bold tracking-tight">{task.title}</h1>
        {task.description && <p className="text-sm text-neutral-400">{task.description}</p>}
      </div>

      <Ring pct={Math.min(100, ratio * 100)} size={280} stroke={16} className={over ? 'text-rose-400' : interrupted ? 'text-neutral-600' : 'text-xp-400'}>
        <span className="text-sm text-neutral-400">Tempo em movimento</span>
        <span className={`text-6xl font-extrabold tabular-nums tracking-tight ${interrupted ? 'text-neutral-500' : ''}`}>{fmtClock(seconds)}</span>
        <span className="text-sm text-neutral-400">meta {fmtClock(task.estimatedSeconds)}</span>
        {task.status !== 'pending' && (
          <span className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-0.5 text-xs font-medium ${pace.cls}`}>
            {running && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
            {pace.label}
          </span>
        )}
      </Ring>

      {interrupted && (
        <p className="max-w-sm text-sm text-rose-300">
          Interrompida por inatividade: o bloco travou em {fmtClock(task.cap)}. Pause e retome pra continuar contando.
        </p>
      )}
      {over && !interrupted && <p className="text-sm text-rose-300">+{fmtClock(seconds - task.estimatedSeconds)} além do estimado</p>}

      {!readOnly && (
        <div className="w-full space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {running ? (
              <button onClick={onPause} disabled={busy} className="btn-ghost py-4 text-base">
                <Pause className="h-5 w-5 fill-current" /> Pausar
              </button>
            ) : (
              <button onClick={onStart} disabled={busy} className="btn-primary py-4 text-base">
                <Play className="h-5 w-5 fill-current" /> {task.status === 'pending' ? 'Iniciar' : 'Retomar'}
              </button>
            )}
            <button onClick={onFinish} disabled={busy || task.status === 'pending'} className="btn-white py-4 text-base">
              <CheckCircle2 className="h-5 w-5" /> Concluir
            </button>
          </div>
          <p className="text-xs text-neutral-500">
            {running ? 'Tempo contando para o ranking do dia' : 'Cronômetro parado: sem impacto no ritmo'}
          </p>
        </div>
      )}
    </div>
  )
}
