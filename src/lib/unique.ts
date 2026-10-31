/** Quem está em duas equipes aparece uma vez por equipe nas listas de membros; para escolher uma pessoa basta uma. */
export const uniqueById = <T extends { id: string }>(items: ReadonlyArray<T>) => items.filter((item, index) => items.findIndex((other) => other.id === item.id) === index)
