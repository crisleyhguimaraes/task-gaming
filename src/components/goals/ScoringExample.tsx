import * as React from 'react'
import type { ScoringRules } from '#/server/scoring'
import { scoreTask, validateRules } from '#/server/scoring'

const SECONDS_PER_MINUTE = 60

const signed = (n: number) => (n > 0 ? `+${n}` : `−${Math.abs(n)}`)

/** Ao vivo: roda o mesmo `scoreTask` do servidor com as regras que estão no formulário. Sem pausas, o tempo decorrido é o tempo ativo. */
export function ScoringExample({ rules }: { rules: ScoringRules }) {
  const [base, setBase] = React.useState('100')
  const [estimated, setEstimated] = React.useState('30')
  const [actual, setActual] = React.useState('20')
  const [basePoints, estimatedMinutes, actualMinutes] = [Number(base), Number(estimated), Number(actual)]
  const inputsOk = [basePoints, estimatedMinutes, actualMinutes].every((n) => Number.isFinite(n) && n > 0)
  const rulesOk = validateRules(rules).length === 0

  return (
    <section aria-labelledby="scoring-example" className="space-y-3 rounded-xl border border-neutral-800 bg-neutral-950/40 p-3">
      <h4 id="scoring-example" className="text-sm font-semibold">Exemplo ao vivo</h4>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <ExampleField id="example-base" label="Pontos base" value={base} onChange={setBase} />
        <ExampleField id="example-estimated" label="Estimada (min)" value={estimated} onChange={setEstimated} />
        <ExampleField id="example-actual" label="Concluída em (min)" value={actual} onChange={setActual} />
      </div>
      <div role="status" className="text-sm text-neutral-300">
        {inputsOk && rulesOk ? (
          <Outcome rules={rules} basePoints={basePoints} estimatedMinutes={estimatedMinutes} actualMinutes={actualMinutes} />
        ) : (
          'Corrija os valores para ver o exemplo.'
        )}
      </div>
    </section>
  )
}

type OutcomeProps = { rules: ScoringRules; basePoints: number; estimatedMinutes: number; actualMinutes: number }

function Outcome({ rules, basePoints, estimatedMinutes, actualMinutes }: OutcomeProps) {
  const result = scoreTask(
    { basePoints, estimatedSeconds: estimatedMinutes * SECONDS_PER_MINUTE, movingSeconds: actualMinutes * SECONDS_PER_MINUTE, elapsedSeconds: actualMinutes * SECONDS_PER_MINUTE },
    rules,
  )
  const all: Array<[label: string, points: number]> = [
    ['bônus de ritmo', result.paceBonus],
    ['estouro de tempo', result.overtimePenalty],
    ['pausa', result.pausePenalty],
  ]
  const adjustments = all.filter(([, points]) => points !== 0)
  return (
    <p>
      Tarefa de {basePoints} pts, estimada em {estimatedMinutes} min, concluída em {actualMinutes} min → <b className="text-neutral-50">{result.finalPoints} pts</b>
      {adjustments.length > 0 && <span className="text-neutral-500"> ({adjustments.map(([label, points]) => `${label} ${signed(points)}`).join(', ')})</span>}
      {result.needsValidation && <span className="text-amber-400"> · pontos retidos até o líder validar</span>}
    </p>
  )
}

type FieldProps = { id: string; label: string; value: string; onChange: (value: string) => void }

function ExampleField({ id, label, value, onChange }: FieldProps) {
  return (
    <div className="space-y-1">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="number" inputMode="decimal" min={1} step="any" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}
