import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm'
import { db } from '#/db'
import type { Priority } from '#/db/schema'
import { challenges, opportunities, taskTimeLogs, tasks, teams, users } from '#/db/schema'
import { diffFields } from '#/lib/audit'
import { recordAudit } from './audit.core'
import { openBlockers } from './dependencies.core'
import { notify } from './notifications.core'
import type { AuthCtx } from './roles'
import { canManage, canSee, fail, forbid, isAdmin, requireCan } from './roles'
import { assertMember, inTeams, inTenantTeams } from './scope'
import { scoreTask } from './scoring'
import { capFor, closeLogDuration, summarizeLogs } from './time'
import type { Tx } from './tx'

export { canManage, canSee, fail, isAdmin }

/** Fecha logs abertos que casem com `where`, aplicando o teto. Retorna os taskIds afetados. */
async function closeOpenLogs(tx: Tx, where: ReturnType<typeof eq>, now: Date) {
  const open = await tx
    .select({ id: taskTimeLogs.id, taskId: taskTimeLogs.taskId, startedAt: taskTimeLogs.startedAt, est: tasks.estimatedSeconds })
    .from(taskTimeLogs)
    .innerJoin(tasks, eq(tasks.id, taskTimeLogs.taskId))
    .where(and(isNull(taskTimeLogs.stoppedAt), where))
  for (const log of open) {
    await tx
      .update(taskTimeLogs)
      .set({ stoppedAt: now, durationSeconds: closeLogDuration(log.startedAt, now, log.est) })
      .where(eq(taskTimeLogs.id, log.id))
  }
  return open.map((l) => l.taskId)
}

async function loadTask(tx: Tx, me: AuthCtx, taskId: string) {
  const [task] = await tx.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.tenantId, me.tenantId)))
  if (!task || !canSee(me, task)) fail('Tarefa não encontrada')
  return task
}

/** Inicia (ou retoma / puxa do pool). Pausa qualquer outra tarefa do usuário. */
export async function startTaskFor(me: AuthCtx, taskId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    // Antes de qualquer consulta que devolva dado da tarefa: fora do tenant ou da visibilidade, ela não existe.
    await loadTask(tx, me, taskId)
    const [blocker] = await openBlockers(tx, [taskId]).limit(1)
    if (blocker) fail(`Bloqueada: depende de "${blocker.title}"`)
    const pausedIds = await closeOpenLogs(tx, eq(taskTimeLogs.userId, me.userId), now)
    if (pausedIds.length) {
      await tx.update(tasks).set({ status: 'paused' }).where(and(inArray(tasks.id, pausedIds), eq(tasks.status, 'in_progress')))
    }
    // Lock atômico: só pega se ainda estiver livre ou for minha.
    const [task] = await tx
      .update(tasks)
      .set({
        assignedToId: me.userId,
        status: 'in_progress',
        startedAt: sql`coalesce(${tasks.startedAt}, ${now.toISOString()}::timestamptz)`,
      })
      .where(
        and(
          eq(tasks.id, taskId),
          eq(tasks.tenantId, me.tenantId),
          inArray(tasks.status, ['pending', 'paused']),
          or(isNull(tasks.assignedToId), eq(tasks.assignedToId, me.userId)),
          inTeams(tasks.teamId, me),
        ),
      )
      .returning()
    if (!task) fail('Tarefa indisponível: já foi iniciada por outra pessoa ou concluída')
    await tx.insert(taskTimeLogs).values({ taskId, userId: me.userId, startedAt: now })
    return task
  })
}

export async function pauseTaskFor(me: AuthCtx, taskId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const task = await loadTask(tx, me, taskId)
    if (task.status !== 'in_progress') fail('Tarefa não está em andamento')
    if (task.assignedToId !== me.userId && !canManage(me, task)) forbid()
    await closeOpenLogs(tx, eq(taskTimeLogs.taskId, taskId), now)
    const [updated] = await tx.update(tasks).set({ status: 'paused' }).where(eq(tasks.id, taskId)).returning()
    return updated!
  })
}

export type FinishSummary = {
  taskId: string
  taskTitle: string
  basePoints: number
  estimatedSeconds: number
  movingSeconds: number
  elapsedSeconds: number
  paceBonus: number
  overtimePenalty: number
  pausePenalty: number
  finalPoints: number
  needsValidation: boolean
  manual: boolean
  isNewRecord: boolean
}

/** Melhor tempo válido do desafio, ignorando `excludeTaskId`. */
async function challengeBest(tx: Tx, challengeId: string, excludeTaskId: string) {
  const [r] = await tx
    .select({ best: sql<number | null>`min(${tasks.movingSeconds})` })
    .from(tasks)
    .where(and(eq(tasks.challengeId, challengeId), eq(tasks.status, 'finished'), eq(tasks.needsValidation, false), sql`${tasks.id} <> ${excludeTaskId}`))
  return r?.best ?? null
}

export async function finishTaskFor(me: AuthCtx, taskId: string, now = new Date()): Promise<FinishSummary> {
  return db.transaction(async (tx) => {
    const task = await loadTask(tx, me, taskId)
    if (task.status !== 'in_progress' && task.status !== 'paused') fail('Tarefa não está em execução')
    if (task.assignedToId !== me.userId && !canManage(me, task)) forbid()
    await closeOpenLogs(tx, eq(taskTimeLogs.taskId, taskId), now)
    const logs = await tx.select().from(taskTimeLogs).where(eq(taskTimeLogs.taskId, taskId)).orderBy(asc(taskTimeLogs.startedAt))
    const { movingSeconds, elapsedSeconds } = summarizeLogs(logs, task.estimatedSeconds, now)
    const score = scoreTask({ basePoints: task.basePoints, estimatedSeconds: task.estimatedSeconds, movingSeconds, elapsedSeconds })
    const prevBest = task.challengeId ? await challengeBest(tx, task.challengeId, task.id) : null
    const isNewRecord = task.challengeId !== null && !score.needsValidation && (prevBest === null || movingSeconds < prevBest)
    await tx
      .update(tasks)
      .set({
        status: 'finished',
        finishedAt: now,
        movingSeconds,
        elapsedSeconds,
        awardedPoints: score.finalPoints,
        needsValidation: score.needsValidation,
      })
      .where(eq(tasks.id, taskId))
    return {
      taskId,
      taskTitle: task.title,
      basePoints: task.basePoints,
      estimatedSeconds: task.estimatedSeconds,
      movingSeconds,
      elapsedSeconds,
      ...score,
      manual: false,
      isNewRecord,
    }
  })
}

/** Tenta um desafio: retoma minha tentativa aberta ou cria uma nova task e inicia. */
export async function attemptChallengeFor(me: AuthCtx, challengeId: string, now = new Date()) {
  const [c] = await db
    .select()
    .from(challenges)
    .where(and(eq(challenges.id, challengeId), eq(challenges.tenantId, me.tenantId), isNull(challenges.archivedAt)))
  if (!c || (!isAdmin(me) && c.teamId !== me.teamId)) fail('Desafio não encontrado')
  const [open] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.challengeId, c.id), eq(tasks.assignedToId, me.userId), inArray(tasks.status, ['pending', 'in_progress', 'paused'])))
    .limit(1)
  if (open) return startTaskFor(me, open.id, now)
  const [t] = await db
    .insert(tasks)
    .values({
      tenantId: c.tenantId,
      teamId: c.teamId,
      assignedToId: me.userId,
      createdById: me.userId,
      challengeId: c.id,
      title: c.title,
      description: c.description,
      basePoints: c.basePoints,
      estimatedSeconds: c.estimatedSeconds,
    })
    .returning()
  return startTaskFor(me, t!.id, now)
}

/** Conclusão manual (Kanban): pontos base, sem cronômetro. */
export async function finishTaskManuallyFor(me: AuthCtx, taskId: string, now = new Date()): Promise<FinishSummary> {
  return db.transaction(async (tx) => {
    const task = await loadTask(tx, me, taskId)
    if (task.status !== 'pending' && task.status !== 'paused') fail('Só tarefas pendentes ou pausadas podem ser concluídas manualmente')
    if (task.assignedToId && task.assignedToId !== me.userId && !canManage(me, task)) forbid()
    await closeOpenLogs(tx, eq(taskTimeLogs.taskId, taskId), now)
    const [updated] = await tx
      .update(tasks)
      .set({
        status: 'finished',
        assignedToId: task.assignedToId ?? me.userId,
        startedAt: sql`coalesce(${tasks.startedAt}, ${now.toISOString()}::timestamptz)`,
        finishedAt: now,
        movingSeconds: task.estimatedSeconds,
        elapsedSeconds: task.estimatedSeconds,
        awardedPoints: task.basePoints,
        needsValidation: false,
        manualFinish: true,
      })
      .where(eq(tasks.id, taskId))
      .returning()
    await recordAudit(tx, me, {
      action: 'task.finished_manually',
      entityType: 'task',
      entityId: taskId,
      changes: diffFields(task, updated!, ['status', 'assignedToId', 'awardedPoints']),
    })
    return {
      taskId,
      taskTitle: task.title,
      basePoints: task.basePoints,
      estimatedSeconds: task.estimatedSeconds,
      movingSeconds: task.estimatedSeconds,
      elapsedSeconds: task.estimatedSeconds,
      paceBonus: 0,
      overtimePenalty: 0,
      pausePenalty: 0,
      finalPoints: task.basePoints,
      needsValidation: false,
      manual: true,
      isNewRecord: false,
    }
  })
}

/** Devolve ao pool: dono ou gestor. Logs antigos ficam no histórico. */
export async function returnToPoolFor(me: AuthCtx, taskId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const task = await loadTask(tx, me, taskId)
    if (task.status !== 'in_progress' && task.status !== 'paused' && task.status !== 'pending') fail('Tarefa não está aberta')
    if (task.assignedToId !== me.userId && !canManage(me, task)) forbid()
    if (task.challengeId) fail('Tentativa de desafio não vai pro pool')
    await closeOpenLogs(tx, eq(taskTimeLogs.taskId, taskId), now)
    const [updated] = await tx.update(tasks).set({ status: 'pending', assignedToId: null }).where(eq(tasks.id, taskId)).returning()
    await recordAudit(tx, me, {
      action: 'task.returned_to_pool',
      entityType: 'task',
      entityId: taskId,
      changes: diffFields(task, updated!, ['status', 'assignedToId']),
    })
    return updated!
  })
}

/** Cancela (gestor). Tempo fica pra métricas; pontos não. */
export async function cancelTaskFor(me: AuthCtx, taskId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const task = await loadTask(tx, me, taskId)
    if (!canManage(me, task)) forbid()
    if (task.status === 'finished' || task.status === 'cancelled') fail('Tarefa já encerrada')
    await closeOpenLogs(tx, eq(taskTimeLogs.taskId, taskId), now)
    const [updated] = await tx.update(tasks).set({ status: 'cancelled', awardedPoints: null }).where(eq(tasks.id, taskId)).returning()
    await recordAudit(tx, me, {
      action: 'task.cancelled',
      entityType: 'task',
      entityId: taskId,
      changes: diffFields(task, updated!, ['status', 'awardedPoints']),
    })
    return updated!
  })
}

/** Aprova ou rejeita pontos retidos (gestor). */
export async function validatePointsFor(me: AuthCtx, taskId: string, approve: boolean, reason?: string) {
  return db.transaction(async (tx) => {
    const task = await loadTask(tx, me, taskId)
    if (!canManage(me, task)) forbid()
    if (task.status !== 'finished' || !task.needsValidation) fail('Tarefa não aguarda validação')
    const [updated] = await tx
      .update(tasks)
      .set({ needsValidation: false, awardedPoints: approve ? task.awardedPoints : 0 })
      .where(eq(tasks.id, taskId))
      .returning()
    await recordAudit(tx, me, {
      action: approve ? 'task.points_validated' : 'task.points_rejected',
      entityType: 'task',
      entityId: taskId,
      changes: diffFields(task, updated!, ['needsValidation', 'awardedPoints']),
      meta: reason ? { reason } : undefined,
    })
    await notify(tx, me, {
      userIds: [task.assignedToId],
      type: approve ? 'points.approved' : 'points.rejected',
      entityType: 'task',
      entityId: taskId,
      payload: { taskTitle: task.title, by: me.name },
    })
    return updated!
  })
}

/** Cancelada volta a pendente com o mesmo responsável; os pontos já foram zerados ao cancelar. */
export async function restoreTaskFor(me: AuthCtx, taskId: string) {
  requireCan(me, 'task.restore')
  return db.transaction(async (tx) => {
    const task = await loadTask(tx, me, taskId)
    if (!canManage(me, task)) forbid()
    if (task.status !== 'cancelled') fail('Só tarefas canceladas podem ser restauradas')
    const [updated] = await tx.update(tasks).set({ status: 'pending' }).where(eq(tasks.id, taskId)).returning()
    await recordAudit(tx, me, {
      action: 'task.restored',
      entityType: 'task',
      entityId: taskId,
      changes: diffFields(task, updated!, ['status']),
    })
    return updated!
  })
}

/** Tarefa em andamento/pausada do usuário (HUD). */
export async function activeTaskFor(me: AuthCtx) {
  const rows = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.tenantId, me.tenantId), eq(tasks.assignedToId, me.userId), inArray(tasks.status, ['in_progress', 'paused'])))
    .orderBy(desc(tasks.status))
    .limit(1)
  const task = rows[0]
  if (!task) return null
  return { ...task, ...(await taskPlayerState(task.id, me.userId)), cap: capFor(task.estimatedSeconds) }
}

/** Estado do player: acumulado fechado + bloco aberto (se meu). */
export async function taskPlayerState(taskId: string, userId: string) {
  const logs = await db.select().from(taskTimeLogs).where(eq(taskTimeLogs.taskId, taskId)).orderBy(desc(taskTimeLogs.startedAt))
  const accumulatedSeconds = logs.reduce((acc, l) => acc + (l.durationSeconds ?? 0), 0)
  const open = logs.find((l) => l.stoppedAt === null && l.userId === userId)
  return { accumulatedSeconds, activeStartedAt: open ? open.startedAt.toISOString() : null }
}

export { capFor }

export type NewTask = {
  title: string
  description?: string
  basePoints: number
  estimatedMinutes: number
  teamId: string
  assignedToId: string | null
  opportunityId?: string
}

async function assertOpportunityOfTeam(tx: Tx, me: AuthCtx, opportunityId: string | undefined, teamId: string) {
  if (!opportunityId) return
  const [o] = await tx
    .select({ id: opportunities.id })
    .from(opportunities)
    .where(and(eq(opportunities.id, opportunityId), eq(opportunities.tenantId, me.tenantId), eq(opportunities.teamId, teamId)))
  if (!o) fail('Oportunidade não encontrada')
}

function notifyAssignee(tx: Tx, me: AuthCtx, task: { id: string; title: string; assignedToId: string | null }) {
  return notify(tx, me, {
    userIds: [task.assignedToId],
    type: 'task.assigned',
    entityType: 'task',
    entityId: task.id,
    payload: { taskTitle: task.title, by: me.name },
  })
}

export async function createTaskFor(me: AuthCtx, data: NewTask) {
  if (!canManage(me, { teamId: data.teamId })) forbid()
  return db.transaction(async (tx) => {
    const [team] = await tx.select({ id: teams.id }).from(teams).where(and(eq(teams.id, data.teamId), eq(teams.tenantId, me.tenantId)))
    if (!team) fail('Equipe não encontrada')
    if (data.assignedToId) await assertMember(tx, { tenantId: me.tenantId, userId: data.assignedToId, teamId: data.teamId })
    await assertOpportunityOfTeam(tx, me, data.opportunityId, data.teamId)
    const [task] = await tx
      .insert(tasks)
      .values({
        tenantId: me.tenantId,
        teamId: data.teamId,
        assignedToId: data.assignedToId,
        opportunityId: data.opportunityId ?? null,
        createdById: me.userId,
        title: data.title,
        description: data.description || null,
        basePoints: data.basePoints,
        estimatedSeconds: data.estimatedMinutes * 60,
      })
      .returning()
    await recordAudit(tx, me, {
      action: 'task.created',
      entityType: 'task',
      entityId: task!.id,
      meta: { title: task!.title, teamId: task!.teamId, assignedToId: task!.assignedToId, opportunityId: task!.opportunityId },
    })
    await notifyAssignee(tx, me, task!)
    return task!
  })
}

export type TaskEdit = Omit<NewTask, 'teamId'> & {
  taskId: string
  priority: Priority
  dueDate: string | null
  scheduledStart: string | null
  scheduledEnd: string | null
}

const auditedTaskFields = ['title', 'description', 'basePoints', 'estimatedSeconds', 'priority', 'dueDate', 'scheduledStart', 'scheduledEnd', 'assignedToId'] as const

export async function updateTaskFor(me: AuthCtx, data: TaskEdit) {
  await db.transaction(async (tx) => {
    const [task] = await tx.select().from(tasks).where(and(eq(tasks.id, data.taskId), eq(tasks.tenantId, me.tenantId)))
    if (!task || !canManage(me, task)) forbid()
    if (task.status === 'finished' || task.status === 'cancelled') fail('Tarefa encerrada não pode ser editada')
    if (data.assignedToId) await assertMember(tx, { tenantId: me.tenantId, userId: data.assignedToId, teamId: task.teamId })
    if (task.status !== 'pending' && data.assignedToId !== task.assignedToId) fail('Só tarefas pendentes podem ser reatribuídas')
    if (data.scheduledStart && data.scheduledEnd && data.scheduledEnd < data.scheduledStart) fail('Fim do cronograma antes do início')
    const [updated] = await tx
      .update(tasks)
      .set({
        title: data.title,
        description: data.description || null,
        basePoints: data.basePoints,
        estimatedSeconds: data.estimatedMinutes * 60,
        priority: data.priority,
        dueDate: data.dueDate,
        scheduledStart: data.scheduledStart,
        scheduledEnd: data.scheduledEnd,
        assignedToId: data.assignedToId,
      })
      .where(eq(tasks.id, task.id))
      .returning()
    const changes = diffFields(task, updated!, auditedTaskFields)
    if (Object.keys(changes).length) await recordAudit(tx, me, { action: 'task.updated', entityType: 'task', entityId: task.id, changes })
    if (updated!.assignedToId !== task.assignedToId) await notifyAssignee(tx, me, updated!)
  })
}

export type TaskListFilters = { teamId?: string; assigneeId?: string; priority?: Priority; search?: string }

/** Escopo de visibilidade compartilhado entre a lista do board e a exportação. */
export function taskListWhere(me: AuthCtx, filters: TaskListFilters) {
  return and(
    eq(tasks.tenantId, me.tenantId),
    inTeams(tasks.teamId, me, { only: filters.teamId }),
    isNull(tasks.challengeId),
    filters.assigneeId === 'pool' ? isNull(tasks.assignedToId) : filters.assigneeId ? eq(tasks.assignedToId, filters.assigneeId) : undefined,
    filters.priority ? eq(tasks.priority, filters.priority) : undefined,
    filters.search ? or(ilike(tasks.title, `%${filters.search}%`), ilike(tasks.description, `%${filters.search}%`)) : undefined,
  )
}

/** Quem pode aparecer como responsável no filtro do board, no mesmo escopo da lista. */
export function boardMembersFor(me: AuthCtx, teamId?: string) {
  return db.select({ id: users.id, name: users.name }).from(users).where(inTenantTeams(users, me, { only: teamId })).orderBy(asc(users.name))
}
