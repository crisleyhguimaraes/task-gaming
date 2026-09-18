import * as React from 'react'

/** Cronômetro local: acumulado dos blocos fechados + bloco aberto (travado no teto). */
export function useElapsed(accumulated: number, activeStartedAt: string | null, cap: number) {
  const calc = React.useCallback(() => {
    if (!activeStartedAt) return { seconds: accumulated, interrupted: false }
    const run = Math.floor((Date.now() - new Date(activeStartedAt).getTime()) / 1000)
    return { seconds: accumulated + Math.min(cap, Math.max(0, run)), interrupted: run > cap }
  }, [accumulated, activeStartedAt, cap])
  // Estado inicial sem Date.now() pra não divergir na hidratação.
  const [state, setState] = React.useState({ seconds: accumulated, interrupted: false })
  React.useEffect(() => {
    setState(calc())
    if (!activeStartedAt) return
    const t = setInterval(() => setState(calc()), 1000)
    return () => clearInterval(t)
  }, [calc, activeStartedAt])
  return state
}
