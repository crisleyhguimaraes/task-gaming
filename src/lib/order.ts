/** Posição flutuante entre vizinhos: evita reescrever a coluna inteira a cada drag. */
export function calculateNewOrder(prev: number | null, next: number | null) {
  if (prev === null && next === null) return 1000
  if (prev === null) return next! - 1000
  if (next === null) return prev + 1000
  return (prev + next) / 2
}
