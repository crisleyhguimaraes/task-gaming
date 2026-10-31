import { useRouter } from '@tanstack/react-router'
import * as React from 'react'

export type Act = (action: () => Promise<unknown>) => Promise<void>

export const messageOf = (error: unknown, fallback = 'Erro') => (error instanceof Error ? error.message : fallback)

/** Roda uma ação do servidor guardando a mensagem de erro para exibir junto do formulário. */
export function useAttempt() {
  const [error, setError] = React.useState<string | null>(null)
  async function attempt(action: () => Promise<unknown>) {
    try {
      await action()
      setError(null)
    } catch (e) {
      setError(messageOf(e))
    }
  }
  return { error, setError, attempt }
}

/** `attempt` que, dando certo, recarrega os dados da rota. */
export function useAct() {
  const router = useRouter()
  const { error, attempt } = useAttempt()
  const act: Act = (action) =>
    attempt(async () => {
      await action()
      router.invalidate()
    })
  return { error, act }
}
