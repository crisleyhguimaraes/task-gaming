import type { SQL } from 'drizzle-orm'
import { and, asc, count, eq, getTableColumns, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import { db } from '#/db'
import { challenges, taskTimeLogs, tasks, teamMembers, teams, tenants, users } from '#/db/schema'
import { MS_PER_DAY, activeDaysOf, computeStreak, dayKey, goalForWeekday, weekdayOf } from '#/lib/goals'
import { effectiveGoalsOf } from './goals.core'
import type { AuthCtx } from './roles'
import { can, canManage, canManageWith, fail, isAdmin, isManager, managedTeamIds } from './roles'
import { inManagedTeams, inMemberTeams, inTenantTeams } from './scope'

export const validPoints = and(eq(tasks.status, 'finished'), eq(tasks.needsValidation, false), isNull(tasks.rejectedAt))
const unassigned = and(eq(tasks.status, 'pending'), isNull(tasks.assignedToId), isNull(tasks.challengeId))

/** Dia local do tenant em SQL: (ts AT TIME ZONE tz)::date */
export const localDay = (col: typeof tasks.finishedAt, tz: string) => sql`(${col} at time zone ${tz})::date`
export const localDayOf = (instant: Date, tz: string) => sql`(${instant.toISOString()}::timestamptz at time zone ${tz})::date`
export const todayLocal = (tz: string) => sql`(now() at time zone ${tz})::date`

export type Period = 'day' | 'week' | 'all'
function periodFilter(period: Period, tz: string) {
  if (period === 'day') return sql`${localDay(tasks.finishedAt, tz)} = ${todayLocal(tz)}`
  if (period === 'week') return sql`${localDay(tasks.finishedAt, tz)} >= date_trunc('week', now() at time zone ${tz})::date`
  return undefined
}

export async function tenantSettings(tenantId: string) {
  const [t] = await db.select({ timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, tenantId))
  if (!t) fail('Tenant não encontrado')
  return t
}

export async function todayProgress(userId: string, tz: string) {
  const [r] = await db
    .select({
      points: sql<number>`coalesce(sum(${tasks.awardedPoints}), 0)::int`,
      finished: sql<number>`count(*)::int`,
      movingSeconds: sql<number>`coalesce(sum(${tasks.movingSeconds}), 0)::int`,
    })
    .from(tasks)
    .where(and(eq(tasks.assignedToId, userId), validPoints, periodFilter('day', tz)))
  return r!
}

export async function totalPoints(userId: string) {
  const [r] = await db
    .select({ points: sql<number>`coalesce(sum(${tasks.awardedPoints}), 0)::int` })
    .from(tasks)
    .where(and(eq(tasks.assignedToId, userId), validPoints))
  return r!.points
}

export async function finishedCount(userId: string) {
  const [r] = await db.select({ n: count() }).from(tasks).where(and(eq(tasks.assignedToId, userId), validPoints))
  return r!.n
}

/** Ritmo = % de tarefas concluídas dentro do estimado; Foco = média ativo/decorrido. Só tarefas cronometradas. */
export async function heroStats(userId: string) {
  const [r] = await db
    .select({
      total: sql<number>`count(*)::int`,
      onPace: sql<number>`count(*) filter (where ${tasks.movingSeconds} <= ${tasks.estimatedSeconds})::int`,
      focus: sql<number>`coalesce(avg(${tasks.movingSeconds}::float / greatest(${tasks.elapsedSeconds}, 1)), 0)`,
    })
    .from(tasks)
    .where(and(eq(tasks.assignedToId, userId), validPoints, eq(tasks.manualFinish, false)))
  const total = r?.total ?? 0
  return { ritmo: total ? Math.round(((r?.onPace ?? 0) / total) * 100) : 0, foco: Math.round((r?.focus ?? 0) * 100), total }
}

/** Pontos por dia nos últimos `days` dias (dias sem pontos entram com 0). */
export async function pointsByDay(userId: string, tz: string, days = 14) {
  const rows = await db
    .select({ day: sql<string>`${localDay(tasks.finishedAt, tz)}::text`, points: sql<number>`coalesce(sum(${tasks.awardedPoints}), 0)::int` })
    .from(tasks)
    .where(and(eq(tasks.assignedToId, userId), validPoints, sql`${tasks.finishedAt} >= now() - make_interval(days => ${days})`))
    .groupBy(sql`1`)
  const byDay = new Map(rows.map((r) => [r.day, r.points]))
  const today = new Date(`${todayKey(tz)}T00:00:00Z`)
  return Array.from({ length: days }, (_, i) => {
    const d = dayKey(new Date(today.getTime() - (days - 1 - i) * MS_PER_DAY))
    return { day: d, points: byDay.get(d) ?? 0 }
  })
}

/** 'YYYY-MM-DD' de agora no fuso do tenant. */
export const todayKey = (tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date())

/** Dias ativos de quem está em várias equipes: a união dos de cada meta. */
export async function streak(userId: string, tz: string, today = todayKey(tz)) {
  const rows = await db
    .selectDistinct({ day: sql<string>`${localDay(tasks.finishedAt, tz)}::text` })
    .from(tasks)
    .where(and(eq(tasks.assignedToId, userId), validPoints))
    .orderBy(sql`1 desc`)
    .limit(400)
  return computeStreak(rows.map((r) => r.day), today, activeDaysOf(await effectiveGoalsOf(db, userId)))
}

/** Meta de um dia 'YYYY-MM-DD' do fuso do tenant: a maior entre as equipes com o dia ativo. `null` é dia livre. */
export async function goalOfDay(userId: string, day: string) {
  return goalForWeekday(await effectiveGoalsOf(db, userId), weekdayOf(day))
}

type RankingRow = { userId: string; name: string; teamId: string; teamName: string; points: number; finished: number; movingSeconds: number }

/**
 * Uma linha por (pessoa, equipe). Os pontos vêm de `tasks.team_id`: o que se ganhou na equipe X fica em X, mesmo que a pessoa
 * tenha saído ou mudado de equipe depois. Ex-membros com pontos no período entram, para a soma bater com o total da equipe.
 */
export async function ranking(me: AuthCtx, period: Period, tz: string, teamId?: string): Promise<Array<RankingRow>> {
  const earned = await db
    .select({
      userId: users.id,
      name: users.name,
      teamId: teams.id,
      teamName: teams.name,
      points: sql<number>`coalesce(sum(${tasks.awardedPoints}), 0)::int`,
      finished: sql<number>`count(${tasks.id})::int`,
      movingSeconds: sql<number>`coalesce(sum(${tasks.movingSeconds}), 0)::int`,
    })
    .from(tasks)
    .innerJoin(users, eq(users.id, tasks.assignedToId))
    .innerJoin(teams, eq(teams.id, tasks.teamId))
    .where(and(inTenantTeams(tasks, me, { only: teamId }), validPoints, periodFilter(period, tz), ne(users.role, 'SUPER_ADMIN')))
    .groupBy(users.id, users.name, teams.id, teams.name)
  const members = await db
    .select({ userId: users.id, name: users.name, teamId: teams.id, teamName: teams.name })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(and(inTenantTeams(teamMembers, me, { only: teamId }), ne(users.role, 'SUPER_ADMIN')))
  const rows = new Map<string, RankingRow>()
  for (const m of members) rows.set(`${m.teamId}:${m.userId}`, { ...m, points: 0, finished: 0, movingSeconds: 0 })
  for (const e of earned) rows.set(`${e.teamId}:${e.userId}`, e)
  return [...rows.values()].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name))
}

const attemptOfChallenge = (condition: SQL | undefined) =>
  inArray(tasks.challengeId, db.select({ id: challenges.id }).from(challenges).where(condition))

/** Equipes donas cujas tentativas `me` valida: admin, todas; o líder, as que lidera e onde tem `challenge.validate`. */
const validatedOwnerTeams = (me: AuthCtx, within: ReadonlyArray<string> | undefined) => {
  if (isAdmin(me)) return can(me, 'challenge.validate') ? within ?? 'all' : []
  return managedTeamIds(me).filter((teamId) => canManageWith(me, 'challenge.validate', teamId) && (!within || within.includes(teamId)))
}

/**
 * Concluídas aguardando validação. Na fila comum entram as tarefas das equipes que `me` gerencia (`commonScope`), exceto as de desafio:
 * a tentativa está na equipe de quem tentou, mas quem valida é a equipe dona, e nunca a própria pessoa.
 */
function awaitingValidation(me: AuthCtx, commonScope: SQL | undefined, withinTeamIds?: ReadonlyArray<string>) {
  const owners = validatedOwnerTeams(me, withinTeamIds)
  const attempts = and(
    eq(tasks.tenantId, me.tenantId),
    sql`${tasks.assignedToId} is distinct from ${me.userId}`,
    attemptOfChallenge(and(eq(challenges.tenantId, me.tenantId), owners === 'all' ? undefined : inArray(challenges.teamId, [...owners]))),
  )
  return and(eq(tasks.status, 'finished'), eq(tasks.needsValidation, true), or(and(commonScope, isNull(tasks.challengeId)), attempts))
}

/** Quem está ativo agora (log aberto) + pool; pausadas e aguardando validação só das equipes que `me` gerencia. */
export async function teamFeed(me: AuthCtx, teamIds: ReadonlyArray<string>) {
  const inFeed = and(eq(tasks.tenantId, me.tenantId), inArray(tasks.teamId, [...teamIds]))
  const managed = and(inFeed, inManagedTeams(tasks.teamId, me))
  const activeNow = await db
    .select({ userId: users.id, name: users.name, taskId: tasks.id, title: tasks.title, since: taskTimeLogs.startedAt, estimatedSeconds: tasks.estimatedSeconds })
    .from(taskTimeLogs)
    .innerJoin(tasks, eq(tasks.id, taskTimeLogs.taskId))
    .innerJoin(users, eq(users.id, taskTimeLogs.userId))
    .where(and(inFeed, isNull(taskTimeLogs.stoppedAt), eq(tasks.status, 'in_progress')))
    .orderBy(asc(taskTimeLogs.startedAt))
  const paused = await db
    .select({ taskId: tasks.id, title: tasks.title, name: users.name })
    .from(tasks)
    .innerJoin(users, eq(users.id, tasks.assignedToId))
    .where(and(managed, eq(tasks.status, 'paused')))
    .orderBy(asc(tasks.title))
  const pendingValidation = await db
    .select({
      taskId: tasks.id,
      title: tasks.title,
      name: users.name,
      teamName: teams.name,
      challengeId: tasks.challengeId,
      points: tasks.awardedPoints,
      movingSeconds: tasks.movingSeconds,
      estimatedSeconds: tasks.estimatedSeconds,
    })
    .from(tasks)
    .innerJoin(users, eq(users.id, tasks.assignedToId))
    .innerJoin(teams, eq(teams.id, tasks.teamId))
    .where(awaitingValidation(me, managed, teamIds))
    .orderBy(asc(tasks.finishedAt))
  const [pool] = await db.select({ n: sql<number>`count(*)::int` }).from(tasks).where(and(inFeed, unassigned))
  return { activeNow, paused, pendingValidation, poolCount: pool!.n }
}

/** Equipe pedida que não se vê, ou admin sem equipe escolhida, fica sem feed; os demais somam as próprias equipes. */
function feedTeamIds(me: AuthCtx, visible: ReadonlyArray<{ id: string }>, chosen: string | null, requested?: string) {
  if (chosen) return [chosen]
  if (requested || isAdmin(me)) return []
  return visible.map((t) => t.id)
}

/** Página Equipe. Equipe pedida que `me` não vê (alheia, de outro tenant) dá vazio, nunca a página de outra. */
export async function teamPageFor(me: AuthCtx, { period, teamId }: { period: Period; teamId?: string }) {
  const { timezone } = await tenantSettings(me.tenantId)
  const visible = await visibleTeams(me)
  const chosen = visible.find((t) => t.id === teamId)?.id ?? null
  const feedTeams = feedTeamIds(me, visible, chosen, teamId)
  return {
    teams: isAdmin(me) || visible.length > 1 ? visible : [],
    teamId: chosen,
    period,
    ranking: await ranking(me, period, timezone, teamId),
    feed: feedTeams.length ? await teamFeed(me, feedTeams) : null,
    canManage: chosen ? canManage(me, { teamId: chosen }) : teamId === undefined && isManager(me),
  }
}

const visibleTeams = (me: AuthCtx) =>
  db
    .select({ id: teams.id, name: teams.name })
    .from(teams)
    .where(and(eq(teams.tenantId, me.tenantId), isAdmin(me) ? undefined : inMemberTeams(teams.id, me)))
    .orderBy(asc(teams.name))

export const openStatuses = ['pending', 'in_progress', 'paused'] as const
export const inOpen = () => inArray(tasks.status, [...openStatuses])

export async function poolOf(me: AuthCtx) {
  const rows = await db
    .select({ task: getTableColumns(tasks), teamName: teams.name })
    .from(tasks)
    .innerJoin(teams, eq(teams.id, tasks.teamId))
    .where(and(eq(tasks.tenantId, me.tenantId), inMemberTeams(tasks.teamId, me), unassigned))
    .orderBy(asc(tasks.createdAt))
  return rows.map(({ task, teamName }) => ({ ...task, teamName }))
}

export async function attentionCount(me: AuthCtx) {
  const [pool] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(and(eq(tasks.tenantId, me.tenantId), inMemberTeams(tasks.teamId, me), unassigned))
  const [val] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(awaitingValidation(me, and(eq(tasks.tenantId, me.tenantId), inManagedTeams(tasks.teamId, me))))
  return { pool: pool!.n, validation: val!.n }
}
