const normalize = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

export function matchesDeal(card: { title: string; leadName: string }, query: string) {
  const needle = normalize(query.trim())
  return needle === '' || normalize(`${card.title} ${card.leadName}`).includes(needle)
}
