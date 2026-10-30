import { createServerFn } from '@tanstack/react-start'
import { and, asc, desc, eq, ilike, inArray, isNull, ne, or } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '#/db'
import { taskDependencies, tasks, teams, users } from '#/db/schema'
import { authMiddleware } from './auth-context'
import { canManage, canSee, fail, isAdmin } from './roles'
import { activeTaskFor, cancelTaskFor, createTaskFor, finishTaskFor, finishTaskManuallyFor, pauseTaskFor, returnToPoolFor, startTaskFor, taskPlayerState, updateTaskFor, validatePointsFor } from './tasks.core'
import { capFor } from './time'
import { heroStats, pointsByDay, ranking, streak, teamFeed, tenantSettings, todayProgress, totalPoints } from './stats'
import { listChallengesFor } from './challenges.core'
import { blockedSet } from './dependencies.core'

const byId = z.object({ taskId: z.uuid() })

export const createTask = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(
    z.object({
      title: z.string().trim().min(2).max(200),
      description: z.string().trim().max(2000).optional(),
      basePoints: z.number().int().min(1).max(10000),
      estimatedMinutes: z.number().int().min(1).max(24 * 60),
      teamId: z.uuid(),
      assignedToId: z.string().nullable(),
    }),
  )
  .handler(({ data, context: { auth: me } }) => createTaskFor(me, data))

export const getTask = createServerFn()
  .middleware([authMiddleware])
  .validator(byId)
  .handler(async ({ data, context: { auth: me } }) => {
    const [row] = await db
      .select({ task: tasks, assigneeName: users.name })
      .from(tasks)
      .leftJoin(users, eq(users.id, tasks.assignedToId))
      .where(and(eq(tasks.id, data.taskId), eq(tasks.tenantId, me.tenantId)))
    if (!row || !canSee(me, row.task)) fail('Tarefa não encontrada')
    const player = await taskPlayerState(row.task.id, me.userId)
    const blockedBy = await db
      .select({ id: tasks.id, title: tasks.title })
      .from(taskDependencies)
      .innerJoin(tasks, eq(tasks.id, taskDependencies.dependsOnTaskId))
      .where(and(eq(taskDependencies.taskId, row.task.id), ne(tasks.status, 'finished')))
    return {
      ...row.task,
      assigneeName: row.assigneeName,
      blockedBy,
      ...player,
      cap: capFor(row.task.estimatedSeconds),
      isMine: row.task.assignedToId === me.userId,
      canManage: canManage(me, row.task),
    }
  })

export const startTask = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(byId)
  .handler(({ data, context }) => startTaskFor(context.auth, data.taskId))

export const pauseTask = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(byId)
  .handler(({ data, context }) => pauseTaskFor(context.auth, data.taskId))

export const finishTask = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(byId)
  .handler(async ({ data, context: { auth: me } }) => {
    const summary = await finishTaskFor(me, data.taskId)
    const { timezone } = await tenantSettings(me.tenantId)
    return { ...summary, totalPoints: await totalPoints(me.userId), streak: await streak(me.userId, timezone) }
  })

export const returnToPool = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(byId)
  .handler(({ data, context }) => returnToPoolFor(context.auth, data.taskId))

export const cancelTask = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(byId)
  .handler(({ data, context }) => cancelTaskFor(context.auth, data.taskId))

export const validatePoints = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(byId.extend({ approve: z.boolean(), reason: z.string().trim().max(300).optional() }))
  .handler(({ data, context }) => validatePointsFor(context.auth, data.taskId, data.approve, data.reason))

/** Página Equipe: ranking (time ou tenant) + feed do time. */
export const getTeam = createServerFn()
  .middleware([authMiddleware])
  .validator(z.object({ period: z.enum(['day', 'week', 'all']).default('week'), teamId: z.uuid().optional() }))
  .handler(async ({ data, context: { auth: me } }) => {
    const { timezone } = await tenantSettings(me.tenantId)
    const teamList = isAdmin(me)
      ? await db.select({ id: teams.id, name: teams.name }).from(teams).where(eq(teams.tenantId, me.tenantId)).orderBy(asc(teams.name))
      : []
    const teamId = isAdmin(me) ? (data.teamId ?? null) : me.teamId
    if (teamId && !isAdmin(me) && teamId !== me.teamId) fail('Sem permissão')
    return {
      teams: teamList,
      teamId,
      period: data.period,
      ranking: await ranking(me.tenantId, teamId, data.period, timezone),
      feed: teamId ? await teamFeed(teamId) : null,
      canManage: canManage(me, { teamId: teamId ?? '' }),
    }
  })

/** Tela "Hoje": progresso do dia, tarefa ativa e minha fila. */
export const getToday = createServerFn()
  .middleware([authMiddleware])
  .handler(async ({ context: { auth: me } }) => {
    const settings = await tenantSettings(me.tenantId)
    const progress = await todayProgress(me.userId, settings.timezone)
    const active = await activeTaskFor(me)
    const queue = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.tenantId, me.tenantId), eq(tasks.assignedToId, me.userId), inArray(tasks.status, ['pending', 'paused'])))
      .orderBy(desc(tasks.status), asc(tasks.createdAt))
    const challenges = await listChallengesFor(me)
    const [u] = await db
      .select({ createdAt: users.createdAt, teamName: teams.name })
      .from(users)
      .leftJoin(teams, eq(teams.id, users.teamId))
      .where(eq(users.id, me.userId))
    const pool = me.teamId
      ? await db
          .select()
          .from(tasks)
          .where(and(eq(tasks.teamId, me.teamId), eq(tasks.status, 'pending'), isNull(tasks.assignedToId), isNull(tasks.challengeId)))
          .orderBy(asc(tasks.createdAt))
      : []
    const hero = await heroStats(me.userId)
    return {
      settings,
      progress,
      streak: await streak(me.userId, settings.timezone),
      totalPoints: await totalPoints(me.userId),
      daysInCompany: u ? Math.floor((Date.now() - u.createdAt.getTime()) / 86_400_000) : 0,
      teamName: u?.teamName ?? null,
      hero: { ...hero, recordes: challenges.filter((c) => c.record?.holderId === me.userId).length },
      pointsByDay: await pointsByDay(me.userId, settings.timezone),
      teamNow: me.teamId ? (await teamFeed(me.teamId)).activeNow : [],
      active,
      queue: queue.filter((t) => t.id !== active?.id),
      pool,
      challenges,
    }
  })

/** Equipes + membros que o usuário pode atribuir (form de nova tarefa). */
export const getTaskFormOptions = createServerFn()
  .middleware([authMiddleware])
  .handler(async ({ context: { auth: me } }) => {
    const teamList = await db
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(and(eq(teams.tenantId, me.tenantId), isAdmin(me) ? undefined : eq(teams.id, me.teamId ?? '')))
      .orderBy(asc(teams.name))
    const memberList = await db
      .select({ id: users.id, name: users.name, teamId: users.teamId })
      .from(users)
      .where(and(eq(users.tenantId, me.tenantId), inArray(users.teamId, teamList.map((t) => t.id))))
      .orderBy(asc(users.name))
    return { teams: teamList, members: memberList }
  })

// --- Board (fase 4) ---------------------------------------------------------

export const taskFilterSchema = z.object({
  view: z.enum(['kanban', 'list', 'timeline']).default('kanban'),
  teamId: z.uuid().optional(),
  assigneeId: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  search: z.string().optional(),
  sort: z.enum(['title', 'priority', 'dueDate', 'basePoints', 'status']).default('status'),
})
export type TaskFilters = z.infer<typeof taskFilterSchema>

export const listTasks = createServerFn()
  .middleware([authMiddleware])
  .validator(taskFilterSchema)
  .handler(async ({ data, context: { auth: me } }) => {
    const teamScope = isAdmin(me) ? (data.teamId ? eq(tasks.teamId, data.teamId) : undefined) : eq(tasks.teamId, me.teamId ?? '')
    const rows = await db
      .select({ task: tasks, assigneeName: users.name, teamName: teams.name })
      .from(tasks)
      .leftJoin(users, eq(users.id, tasks.assignedToId))
      .innerJoin(teams, eq(teams.id, tasks.teamId))
      .where(
        and(
          eq(tasks.tenantId, me.tenantId),
          teamScope,
          isNull(tasks.challengeId),
          data.assigneeId === 'pool' ? isNull(tasks.assignedToId) : data.assigneeId ? eq(tasks.assignedToId, data.assigneeId) : undefined,
          data.priority ? eq(tasks.priority, data.priority) : undefined,
          data.search ? or(ilike(tasks.title, `%${data.search}%`), ilike(tasks.description, `%${data.search}%`)) : undefined,
        ),
      )
      .orderBy(asc(tasks.sortOrder), asc(tasks.createdAt))
    const teamList = isAdmin(me)
      ? await db.select({ id: teams.id, name: teams.name }).from(teams).where(eq(teams.tenantId, me.tenantId)).orderBy(asc(teams.name))
      : []
    const memberList = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(and(eq(users.tenantId, me.tenantId), teamScope ? eq(users.teamId, data.teamId ?? me.teamId ?? '') : undefined))
      .orderBy(asc(users.name))
    const blocked = await blockedSet(rows.map((r) => r.task.id))
    const ids = rows.map((r) => r.task.id)
    const edges = ids.length
      ? await db
          .select({ taskId: taskDependencies.taskId, dependsOnTaskId: taskDependencies.dependsOnTaskId })
          .from(taskDependencies)
          .where(and(inArray(taskDependencies.taskId, ids), inArray(taskDependencies.dependsOnTaskId, ids)))
      : []
    return {
      edges,
      tasks: rows.map((r) => ({ ...r.task, assigneeName: r.assigneeName, teamName: r.teamName, canManage: canManage(me, r.task), isMine: r.task.assignedToId === me.userId, isBlocked: blocked.has(r.task.id) })),
      teams: teamList,
      members: memberList,
    }
  })

export const moveTask = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(byId.extend({ sortOrder: z.number() }))
  .handler(async ({ data, context: { auth: me } }) => {
    const [task] = await db.select().from(tasks).where(and(eq(tasks.id, data.taskId), eq(tasks.tenantId, me.tenantId)))
    if (!task || !canSee(me, task)) fail('Tarefa não encontrada')
    await db.update(tasks).set({ sortOrder: data.sortOrder }).where(eq(tasks.id, task.id))
  })

export const finishTaskManually = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(byId)
  .handler(async ({ data, context: { auth: me } }) => {
    const summary = await finishTaskManuallyFor(me, data.taskId)
    const { timezone } = await tenantSettings(me.tenantId)
    return { ...summary, totalPoints: await totalPoints(me.userId), streak: await streak(me.userId, timezone) }
  })

export const updateTask = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(
    byId.extend({
      title: z.string().trim().min(2).max(200),
      description: z.string().trim().max(2000).optional(),
      basePoints: z.number().int().min(1).max(10000),
      estimatedMinutes: z.number().int().min(1).max(24 * 60),
      priority: z.enum(['low', 'medium', 'high', 'urgent']),
      dueDate: z.iso.date().nullable(),
      scheduledStart: z.iso.date().nullable(),
      scheduledEnd: z.iso.date().nullable(),
      assignedToId: z.string().nullable(),
    }),
  )
  .handler(({ data, context: { auth: me } }) => updateTaskFor(me, data))
