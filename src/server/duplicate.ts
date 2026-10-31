import { fail } from './roles'

const UNIQUE_VIOLATION = '23505'

const codeOf = (error: unknown) => (typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined)

// O Drizzle embrulha o erro do driver em `cause`.
const isUniqueViolation = (error: unknown) => codeOf(error) === UNIQUE_VIOLATION || (error instanceof Error && codeOf(error.cause) === UNIQUE_VIOLATION)

/** Troca a violação de unicidade por uma mensagem clara para quem perdeu a corrida; qualquer outro erro segue como estava. */
export async function failOnDuplicate<T>(message: string, work: PromiseLike<T>) {
  try {
    return await work
  } catch (error) {
    if (isUniqueViolation(error)) fail(message)
    throw error
  }
}
