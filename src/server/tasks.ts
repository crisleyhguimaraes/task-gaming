import { createServerFn } from '@tanstack/react-start'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '#/db'
import { taskDependencies, tasks, teams, users } from '#/db/schema'
import { NO_BOARD } from '#/lib/boards'
import { authMiddleware } from './auth-context'
import { canManage, canSee, fail, isAdmin } from './roles'
import { teamsOfUser } from './team-members.core'
import { activeTaskFor, boardMembersFor, cancelTaskFor, createTaskFor, finishTaskFor, finishTaskManuallyFor, pauseTaskFor, restoreTaskFor, returnToPoolFor, startTaskFor, taskDetailFor, taskFormOptionsFor, taskListWhere, updateTaskFor, validatePointsFor } from './tasks.core'
import { goalOfDay, heroStats, poolOf, pointsByDay, streak, teamFeed, teamPageFor, tenantSettings, todayKey, todayProgress, totalPoints } from './stats'
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
      opportunityId: z.uuid().optional(),
      boardId: z.uuid().nullable().optional(),
    }),
  )
  .handler(({ data, context: { auth: me } }) => createTaskFor(me, data))

export const getTask = createServerFn()
  .middleware([authMiddleware])
  .validator(byId)
  .handler(({ data, context: { auth: me } }) => taskDetailFor(me, data.taskId))

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

export const restoreTask = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(byId)
  .handler(({ data, context }) => restoreTaskFor(context.auth, data.taskId))

export const validatePoints = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(byId.extend({ approve: z.boolean(), reason: z.string().trim().max(300).optional() }))
  .handler(({ data, context }) => validatePointsFor(context.auth, data.taskId, data.approve, data.reason))

/** Página Equipe: ranking (time ou tenant) + feed do time. */
export const getTeam = createServerFn()
  .middleware([authMiddleware])
  .validator(z.object({ period: z.enum(['day', 'week', 'all']).default('week'), teamId: z.uuid().optional() }))
  .handler(({ data, context: { auth: me } }) => teamPageFor(me, data))

/** Tela "Hoje": progresso do dia, tarefa ativa e minha fila. */
export const getToday = createServerFn()
  .middleware([authMiddleware])
  .handler(async ({ context: { auth: me } }) => {
    const { timezone } = await tenantSettings(me.tenantId)
    const progress = await todayProgress(me.userId, timezone)
    const active = await activeTaskFor(me)
    const queue = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.tenantId, me.tenantId), eq(tasks.assignedToId, me.userId), inArray(tasks.status, ['pending', 'paused'])))
      .orderBy(desc(tasks.status), asc(tasks.createdAt))
    const challenges = await listChallengesFor(me)
    const [u] = await db.select({ createdAt: users.createdAt }).from(users).where(eq(users.id, me.userId))
    const hero = await heroStats(me.userId)
    return {
      goal: await goalOfDay(me.userId, todayKey(timezone)),
      progress,
      streak: await streak(me.userId, timezone),
      totalPoints: await totalPoints(me.userId),
      daysInCompany: u ? Math.floor((Date.now() - u.createdAt.getTime()) / 86_400_000) : 0,
      teams: await teamsOfUser(db, me.userId),
      hero: { ...hero, recordes: challenges.filter((c) => c.record?.holderId === me.userId).length },
      pointsByDay: await pointsByDay(me.userId, timezone),
      teamNow: me.memberships.length ? (await teamFeed(me, me.memberships.map((m) => m.teamId))).activeNow : [],
      active,
      queue: queue.filter((t) => t.id !== active?.id),
      pool: await poolOf(me),
      challenges,
    }
  })

/** Equipes que o usuário gerencia + membros ativos delas (form de nova tarefa). */
export const getTaskFormOptions = createServerFn()
  .middleware([authMiddleware])
  .handler(({ context: { auth: me } }) => taskFormOptionsFor(me))

// --- Board (fase 4) ---------------------------------------------------------

export const taskFilterSchema = z.object({
  view: z.enum(['kanban', 'list', 'timeline']).default('kanban'),
  teamId: z.uuid().optional(),
  assigneeId: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  search: z.string().optional(),
  boardId: z.union([z.uuid(), z.literal(NO_BOARD)]).optional(),
  sort: z.enum(['title', 'priority', 'dueDate', 'basePoints', 'status']).default('status'),
})
export type TaskFilters = z.infer<typeof taskFilterSchema>

export const listTasks = createServerFn()
  .middleware([authMiddleware])
  .validator(taskFilterSchema)
  .handler(async ({ data, context: { auth: me } }) => {
    const rows = await db
      .select({ task: tasks, assigneeName: users.name, teamName: teams.name })
      .from(tasks)
      .leftJoin(users, eq(users.id, tasks.assignedToId))
      .innerJoin(teams, eq(teams.id, tasks.teamId))
      .where(taskListWhere(me, data))
      .orderBy(asc(tasks.sortOrder), asc(tasks.createdAt))
    const teamList = isAdmin(me)
      ? await db.select({ id: teams.id, name: teams.name }).from(teams).where(eq(teams.tenantId, me.tenantId)).orderBy(asc(teams.name))
      : []
    const memberList = await boardMembersFor(me, data.teamId)
    const blocked = await blockedSet(db, rows.map((r) => r.task.id))
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
