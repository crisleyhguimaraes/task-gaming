import { AlertCircle, ArrowRight, Clock, Flame, Trophy, Zap } from 'lucide-react'
import { fmtDuration } from '#/lib/format'
import { Modal } from './Modal'

export type CompletionSummary = {
  taskTitle: string
  basePoints: number
  estimatedSeconds: number
  movingSeconds: number
  elapsedSeconds: number
  paceBonus: number
  overtimePenalty: number
  pausePenalty: number
  finalPoints: number
  needsValidation: boolean
  scored: boolean
  totalPoints: number
  manual: boolean
  isNewRecord?: boolean
  streak?: number
}

export function CompletionModal({ summary, onClose }: { summary: CompletionSummary | null; onClose: () => void }) {
  return (
    <Modal open={summary !== null} onClose={onClose}>
      {summary && <Body s={summary} onClose={onClose} />}
    </Modal>
  )
}

function Body({ s, onClose }: { s: CompletionSummary; onClose: () => void }) {
  const pace = Math.round((s.movingSeconds / s.estimatedSeconds) * 100)
  const focus = Math.round((s.movingSeconds / Math.max(1, s.elapsedSeconds)) * 100)
  const Row = ({ label, value, tone = '' }: { label: React.ReactNode; value: string; tone?: string }) => (
    <div className="flex items-center justify-between border-b border-neutral-900 py-1.5 text-sm">
      <span className="flex items-center gap-1.5 text-neutral-400">{label}</span>
      <span className={`font-semibold ${tone || 'text-neutral-200'}`}>{value}</span>
    </div>
  )
  return (
    <div className="space-y-5 rounded-3xl border border-neutral-800 bg-neutral-950 p-6 text-neutral-100 shadow-2xl">
      <div className="space-y-2 text-center">
        <div className="inline-flex rounded-2xl border border-xp-500/20 bg-xp-500/10 p-3.5 text-xp-400">
          <Trophy className="h-8 w-8" />
        </div>
        <h2 className="text-2xl font-bold tracking-tight">{s.isNewRecord ? 'Novo recorde!' : 'Tarefa concluída!'}</h2>
        <p className="truncate text-xs text-neutral-400">{s.taskTitle}</p>
      </div>

      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/90 p-5 text-center">
        <span className="text-sm font-semibold text-neutral-300">Pontos conquistados</span>
        <div className="flex items-baseline justify-center gap-1 text-5xl font-black tracking-tight">
          +{s.finalPoints}
          <span className="text-xl font-bold text-xp-400">pts</span>
        </div>
        {s.needsValidation && (
          <p className="mt-3 flex items-center justify-center gap-1.5 rounded-lg border border-amber-800/50 bg-amber-950/40 px-3 py-1.5 text-xs text-amber-300">
            <AlertCircle className="h-4 w-4 shrink-0" /> Conclusão ultrarrápida: aguardando validação do líder.
          </p>
        )}
        {!s.scored && <p className="mt-2 text-xs text-neutral-500">Tentativa de treino: sem pontos hoje. O tempo conta para o recorde.</p>}
        {s.manual && <p className="mt-2 text-xs text-neutral-500">Concluída manualmente, sem cronômetro.</p>}
      </div>

      {!s.manual && (
        <div>
          <Row label="Pontuação base" value={`+${s.basePoints} pts`} />
          <Row
            label={<><Zap className="h-4 w-4 text-xp-400" /> Ritmo ({pace}% do estimado)</>}
            value={s.paceBonus > 0 ? `+${s.paceBonus} pts` : s.overtimePenalty < 0 ? `${s.overtimePenalty} pts` : '0 pts'}
            tone={s.paceBonus > 0 ? 'text-xp-400' : s.overtimePenalty < 0 ? 'text-rose-400' : ''}
          />
          {s.pausePenalty < 0 && (
            <Row label={<><Clock className="h-4 w-4 text-rose-400" /> Muito tempo pausada</>} value={`${s.pausePenalty} pts`} tone="text-rose-400" />
          )}
          <div className="mt-3 grid grid-cols-2 gap-2.5">
            <Stat label="Tempo ativo" value={fmtDuration(s.movingSeconds)} sub={`meta ${fmtDuration(s.estimatedSeconds)}`} />
            <Stat label="Foco" value={`${focus}%`} sub="ativo / decorrido" />
          </div>
        </div>
      )}

      <div className="flex items-center justify-between rounded-2xl border border-xp-500/20 bg-gradient-to-r from-xp-950/20 via-neutral-900 to-neutral-900 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-xp-500/10 p-2 text-xp-400"><Flame className="h-5 w-5 fill-xp-400" /></div>
          <div>
            <div className="text-xs text-neutral-400">Sequência</div>
            <div className="text-sm font-bold">{s.streak ?? '—'} dias</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-neutral-400">Total geral</div>
          <div className="text-sm font-bold text-xp-400">{s.totalPoints} pts</div>
        </div>
      </div>

      <button onClick={onClose} className="btn-white w-full py-4">
        Continuar para Hoje <ArrowRight className="h-4 w-4" />
      </button>
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-neutral-900 bg-neutral-900/50 p-3">
      <span className="block text-[11px] text-neutral-500">{label}</span>
      <span className="text-base font-bold text-neutral-200">{value}</span>
      <span className="mt-0.5 block text-[10px] text-neutral-500">{sub}</span>
    </div>
  )
}
