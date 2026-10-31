import { fail } from './roles'

const MIN_NAME_LENGTH = 2
const DEFAULT_MAX_NAME_LENGTH = 80

/** `subject` carrega o artigo ("da equipe", "do board"): o gênero muda a frase. */
export function assertValidName(name: string, subject: string, max = DEFAULT_MAX_NAME_LENGTH) {
  const length = name.trim().length
  if (length < MIN_NAME_LENGTH || length > max) fail(`O nome ${subject} precisa ter de ${MIN_NAME_LENGTH} a ${max} caracteres`)
}
