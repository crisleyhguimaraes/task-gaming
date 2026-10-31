import type { TeamRef } from '#/components/teams/model'

export type CatalogItem = { id: string; name: string; isDefault: boolean; teams: ReadonlyArray<TeamRef> }

/** Índice = `Date#getUTCDay`: 0 é domingo. */
export const WEEKDAYS = [
  { day: 0, short: 'Dom', long: 'Domingo' },
  { day: 1, short: 'Seg', long: 'Segunda' },
  { day: 2, short: 'Ter', long: 'Terça' },
  { day: 3, short: 'Qua', long: 'Quarta' },
  { day: 4, short: 'Qui', long: 'Quinta' },
  { day: 5, short: 'Sex', long: 'Sexta' },
  { day: 6, short: 'Sáb', long: 'Sábado' },
] as const

export const teamsHint = (noun: string) => `Equipe marcada passa a usar esta ${noun} no lugar da padrão. Sem marcar, ela segue a padrão do tenant.`

/** Cada equipe está em exatamente um item: no vinculado ou, sem vínculo, na lista do padrão. */
export const allTeams = (items: ReadonlyArray<CatalogItem>): Array<TeamRef> =>
  items.flatMap((item) => item.teams).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))

/** Equipes que já usam outro item que não o `selfId`, com o nome dele. O padrão não conta: é o que se perde ao vincular. */
export const otherOwners = (items: ReadonlyArray<CatalogItem>, selfId: string | null) =>
  new Map(items.filter((item) => !item.isDefault && item.id !== selfId).flatMap((item) => item.teams.map((team) => [team.id, item.name] as const)))
