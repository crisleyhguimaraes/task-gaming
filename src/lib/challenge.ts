import type { AuthCtx } from '#/server/roles'
import { fail, isAdmin } from '#/server/roles'

export const MAX_CHALLENGE_BASE_POINTS = 1000
export const MAX_SCORED_ATTEMPTS_PER_DAY = 100

export const countAttempts = (n: number) => `${n} ${n === 1 ? 'tentativa' : 'tentativas'}`

/** Quem pode competir: a equipe dona (implícita), as vinculadas ou, com `tenantWide`, todas as do tenant. */
export type ChallengeReach = { teamId: string; tenantWide: boolean; sharedTeamIds: ReadonlyArray<string> }

type Competitor = Pick<AuthCtx, 'role' | 'memberships'>

const reaches = (reach: ChallengeReach, teamId: string) => reach.tenantWide || teamId === reach.teamId || reach.sharedTeamIds.includes(teamId)

/** Minhas equipes que podem competir no desafio. Espelha `challengeAccess` (SQL) em challenges.core.ts: mexa nos dois juntos. */
export const competingTeamIds = (me: Pick<AuthCtx, 'memberships'>, reach: ChallengeReach) =>
  me.memberships.map((m) => m.teamId).filter((teamId) => reaches(reach, teamId))

/** Admin vê todos os desafios do tenant, mesmo sem equipe; os demais, os que alguma equipe deles alcança. */
export const canSeeChallenge = (me: Competitor, reach: ChallengeReach) => isAdmin(me) || competingTeamIds(me, reach).length > 0

/** A equipe pela qual a tentativa conta: a pedida, se for candidata; sem pedido, a única candidata. */
export function chooseAttemptTeam(candidateIds: ReadonlyArray<string>, requestedTeamId: string | undefined) {
  if (candidateIds.length === 0) fail('Nenhuma das suas equipes participa deste desafio')
  if (requestedTeamId) {
    if (!candidateIds.includes(requestedTeamId)) fail('Essa equipe não participa deste desafio')
    return requestedTeamId
  }
  if (candidateIds.length > 1) fail('Escolha a equipe')
  return candidateIds[0]!
}

export type TeamBest = { teamId: string; teamName: string; userId: string; seconds: number; finishedAt: Date }

export type TeamRankingRow = {
  teamId: string
  teamName: string
  averageSeconds: number
  participants: number
  participationPct: number
  reachedAt: Date
}

type TeamTally = Pick<TeamRankingRow, 'teamId' | 'teamName' | 'participants' | 'participationPct' | 'reachedAt'> & { totalSeconds: number }

const PERCENT = 100

function tallyTeam(bests: ReadonlyArray<TeamBest>, memberIds: ReadonlySet<string>): TeamTally {
  const currentMembers = bests.filter((b) => memberIds.has(b.userId)).length
  return {
    teamId: bests[0]!.teamId,
    teamName: bests[0]!.teamName,
    totalSeconds: bests.reduce((sum, b) => sum + b.seconds, 0),
    participants: bests.length,
    participationPct: memberIds.size ? Math.round((PERCENT * currentMembers) / memberIds.size) : 0,
    // O resultado da equipe só fecha quando entra o último dos melhores tempos; quem fecha antes chegou primeiro.
    reachedAt: new Date(Math.max(...bests.map((b) => b.finishedAt.getTime()))),
  }
}

/** Média menor vence; empate, mais participantes, depois quem fechou antes, depois o nome. A média é comparada exata, por produto cruzado. */
function byRanking(a: TeamTally, b: TeamTally) {
  return (
    a.totalSeconds * b.participants - b.totalSeconds * a.participants ||
    b.participants - a.participants ||
    a.reachedAt.getTime() - b.reachedAt.getTime() ||
    a.teamName.localeCompare(b.teamName)
  )
}

/**
 * Ranking por equipe: a média do melhor tempo válido de cada participante. `bests` traz um melhor tempo por (equipe da tentativa, pessoa);
 * ex-membros contam no resultado, mas não na participação, que é medida contra os membros de hoje.
 */
export function rankTeams(bests: ReadonlyArray<TeamBest>, memberIdsByTeam: ReadonlyMap<string, ReadonlySet<string>>): Array<TeamRankingRow> {
  const byTeam = new Map<string, Array<TeamBest>>()
  for (const best of bests) byTeam.set(best.teamId, [...(byTeam.get(best.teamId) ?? []), best])
  return [...byTeam.values()]
    .map((teamBests) => tallyTeam(teamBests, memberIdsByTeam.get(teamBests[0]!.teamId) ?? new Set()))
    .sort(byRanking)
    .map(({ totalSeconds, ...row }) => ({ ...row, averageSeconds: Math.round(totalSeconds / row.participants) }))
}
