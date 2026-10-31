import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import { db } from '#/db'
import { taskTimeLogs, tasks, teams, tenants, users } from '#/db/schema'
import type { AuthCtx } from './roles'
import { isAdmin } from './roles'
import { inTenantTeams } from './scope'

const validPoints = and(eq(tasks.status, 'finished'), eq(tasks.needsValidation, false))

/** Dia local do tenant em SQL: (ts AT TIME ZONE tz)::date */
export const localDay = (col: typeof tasks.finishedAt, tz: string) => sql`(${col} at time zone ${tz})::date`
export const localDayOf = (instant: Date, tz: string) => sql`(${instant.toISOString()}::timestamptz at time zone ${tz})::date`
export const todayLocal = (tz: string) => sql`(now() at time zone ${tz})::date`

export type Period = 'day' | 'week' | 'all'
const periodFilter = (period: Period, tz: string) =>
  period === 'day'
    ? sql`${localDay(tasks.finishedAt, tz)} = ${todayLocal(tz)}`
    : period === 'week'
      ? sql`${localDay(tasks.finishedAt, tz)} >= date_trunc('week', now() at time zone ${tz})::date`
      : undefined

export async function tenantSettings(tenantId: string) {
  const [t] = await db.select({ timezone: tenants.timezone, dailyGoalPoints: tenants.dailyGoalPoints }).from(tenants).where(eq(tenants.id, tenantId))
  return t ?? { timezone: 'America/Sao_Paulo', dailyGoalPoints: 100 }
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
    const d = toKey(new Date(today.getTime() - (days - 1 - i) * DAY))
    return { day: d, points: byDay.get(d) ?? 0 }
  })
}

// --- Streak -----------------------------------------------------------------

const DAY = 86_400_000
/** 'YYYY-MM-DD' de agora no fuso do tenant. */
export const todayKey = (tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date())
const toKey = (d: Date) => d.toISOString().slice(0, 10)
const isWeekend = (d: Date) => d.getUTCDay() === 0 || d.getUTCDay() === 6

/** Dias consecutivos com conclusão válida, terminando hoje ou no último dia útil. Fim de semana sem tarefa não quebra. */
export function computeStreak(daysWithTasks: Iterable<string>, today: string) {
  const set = new Set(daysWithTasks)
  let cursor = new Date(`${today}T00:00:00Z`)
  const back = () => {
    cursor = new Date(cursor.getTime() - DAY)
    while (isWeekend(cursor) && !set.has(toKey(cursor))) cursor = new Date(cursor.getTime() - DAY)
  }
  if (!set.has(toKey(cursor))) back() // hoje ainda não pontuou: streak continua vivo até o fim do dia
  let n = 0
  while (set.has(toKey(cursor))) {
    n++
    back()
  }
  return n
}

export async function streak(userId: string, tz: string) {
  const rows = await db
    .selectDistinct({ day: sql<string>`${localDay(tasks.finishedAt, tz)}::text` })
    .from(tasks)
    .where(and(eq(tasks.assignedToId, userId), validPoints))
    .orderBy(sql`1 desc`)
    .limit(400)
  return computeStreak(rows.map((r) => r.day), todayKey(tz))
}

// --- Ranking / feed ---------------------------------------------------------

export async function ranking(me: AuthCtx, period: Period, tz: string, teamId?: string) {
  return db
    .select({
      userId: users.id,
      name: users.name,
      teamName: teams.name,
      points: sql<number>`coalesce(sum(${tasks.awardedPoints}), 0)::int`,
      finished: sql<number>`count(${tasks.id})::int`,
      movingSeconds: sql<number>`coalesce(sum(${tasks.movingSeconds}), 0)::int`,
    })
    .from(users)
    .leftJoin(teams, eq(teams.id, users.teamId))
    .leftJoin(tasks, and(eq(tasks.assignedToId, users.id), validPoints, periodFilter(period, tz)))
    .where(and(inTenantTeams(users, me, { only: teamId }), ne(users.role, 'SUPER_ADMIN')))
    .groupBy(users.id, users.name, teams.name)
    .orderBy(desc(sql`coalesce(sum(${tasks.awardedPoints}), 0)`), asc(users.name))
}

/** Quem está ativo agora (log aberto) + tarefas pausadas + aguardando validação, no time. */
export async function teamFeed(teamId: string) {
  const activeNow = await db
    .select({ userId: users.id, name: users.name, taskId: tasks.id, title: tasks.title, since: taskTimeLogs.startedAt, estimatedSeconds: tasks.estimatedSeconds })
    .from(taskTimeLogs)
    .innerJoin(tasks, eq(tasks.id, taskTimeLogs.taskId))
    .innerJoin(users, eq(users.id, taskTimeLogs.userId))
    .where(and(eq(tasks.teamId, teamId), isNull(taskTimeLogs.stoppedAt), eq(tasks.status, 'in_progress')))
    .orderBy(asc(taskTimeLogs.startedAt))
  const paused = await db
    .select({ taskId: tasks.id, title: tasks.title, name: users.name })
    .from(tasks)
    .innerJoin(users, eq(users.id, tasks.assignedToId))
    .where(and(eq(tasks.teamId, teamId), eq(tasks.status, 'paused')))
    .orderBy(asc(tasks.title))
  const pendingValidation = await db
    .select({ taskId: tasks.id, title: tasks.title, name: users.name, points: tasks.awardedPoints, movingSeconds: tasks.movingSeconds, estimatedSeconds: tasks.estimatedSeconds })
    .from(tasks)
    .innerJoin(users, eq(users.id, tasks.assignedToId))
    .where(and(eq(tasks.teamId, teamId), eq(tasks.status, 'finished'), eq(tasks.needsValidation, true)))
    .orderBy(asc(tasks.finishedAt))
  const pool = await db
    .select({ taskId: tasks.id, title: tasks.title, basePoints: tasks.basePoints })
    .from(tasks)
    .where(and(eq(tasks.teamId, teamId), eq(tasks.status, 'pending'), isNull(tasks.assignedToId), isNull(tasks.challengeId)))
  return { activeNow, paused, pendingValidation, poolCount: pool.length }
}

export const openStatuses = ['pending', 'in_progress', 'paused'] as const
export const inOpen = () => inArray(tasks.status, [...openStatuses])

/** Sino: tarefas no pool da minha equipe + (gestor) conclusões aguardando validação. */
export async function attentionCount(me: AuthCtx) {
  const [pool] = me.teamId
    ? await db
        .select({ n: sql<number>`count(*)::int` })
        .from(tasks)
        .where(and(eq(tasks.teamId, me.teamId), eq(tasks.status, 'pending'), isNull(tasks.assignedToId), isNull(tasks.challengeId)))
    : [{ n: 0 }]
  const manages = isAdmin(me) || me.role === 'TEAM_LEADER'
  const [val] = manages
    ? await db
        .select({ n: sql<number>`count(*)::int` })
        .from(tasks)
        .where(and(inTenantTeams(tasks, me), eq(tasks.status, 'finished'), eq(tasks.needsValidation, true)))
    : [{ n: 0 }]
  return { pool: pool?.n ?? 0, validation: val?.n ?? 0 }
}
