import type { SQL } from 'drizzle-orm'
import { and, asc, count, desc, eq, ilike, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm'
import { db } from '#/db'
import type { Priority } from '#/db/schema'
import { challenges, opportunities, taskTimeLogs, tasks, teamMembers, teams, users } from '#/db/schema'
import { diffFields } from '#/lib/audit'
import { NO_BOARD } from '#/lib/boards'
import { chooseAttemptTeam } from '#/lib/challenge'
import { recordAudit } from './audit.core'
import { lockBoardForTask } from './boards.core'
import { accessibleChallenge, bestFirst, lockChallengeForAttempt, ownerTeamOf, scoringAttempt, validAttempt } from './challenges.core'
import { openBlockers } from './dependencies.core'
import { notify } from './notifications.core'
import type { AuthCtx, Capability } from './roles'
import { canManage, canManageWith, canSee, fail, forbid, isAdmin } from './roles'
import { activeMembersByTeam, assertMember, inManagedTeams, inTeams, lockActiveMember, usersInScope } from './scope'
import { effectiveRules, scoreTask } from './scoring'
import { snapshotOfTeam } from './scoring-rules.core'
import { inOpen, localDay, localDayOf, tenantSettings } from './stats'
import { capFor, closeLogDuration, summarizeLogs } from './time'
import type { Reader, Tx } from './tx'

/** Fecha logs abertos que casem com `where`, aplicando o teto. Retorna os taskIds afetados. */
async function closeOpenLogs(tx: Tx, where: SQL | undefined, now: Date) {
  const open = await tx
    .select({ id: taskTimeLogs.id, taskId: taskTimeLogs.taskId, startedAt: taskTimeLogs.startedAt, est: tasks.estimatedSeconds, snapshot: tasks.scoringSnapshot })
    .from(taskTimeLogs)
    .innerJoin(tasks, eq(tasks.id, taskTimeLogs.taskId))
    .where(and(isNull(taskTimeLogs.stoppedAt), where))
  for (const log of open) {
    await tx
      .update(taskTimeLogs)
      .set({ stoppedAt: now, durationSeconds: closeLogDuration(log.startedAt, now, log.est, effectiveRules(log.snapshot)) })
      .where(eq(taskTimeLogs.id, log.id))
  }
  return open.map((l) => l.taskId)
}

type Task = typeof tasks.$inferSelect

/** FOR UPDATE: duas operações simultâneas na mesma tarefa se enfileiram em vez de decidir sobre o mesmo estado. Sem checar visibilidade. */
async function lockTask(tx: Tx, me: AuthCtx, taskId: string) {
  const [task] = await tx.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.tenantId, me.tenantId))).for('update')
  if (!task) fail('Tarefa não encontrada')
  return task
}

async function loadTask(tx: Tx, me: AuthCtx, taskId: string) {
  const task = await lockTask(tx, me, taskId)
  if (!canSee(me, task)) fail('Tarefa não encontrada')
  return task
}

/** Quem não vê a tarefa não sabe que ela existe; quem vê e não pode agir recebe a negação. */
const denyAccess = (me: AuthCtx, task: Task): never => (canSee(me, task) ? forbid() : fail('Tarefa não encontrada'))

/** O líder da equipe dona gerencia as tentativas do desafio dele, mesmo as feitas por pessoas de outra equipe. */
export async function managesAttempt(tx: Reader, me: AuthCtx, task: Pick<Task, 'tenantId' | 'challengeId'>) {
  const owner = await ownerTeamOf(tx, me.tenantId, task.challengeId)
  return owner !== null && canManage(me, { teamId: owner })
}

/** Quem abre a tarefa: quem a vê pela equipe e, na tentativa de desafio, o líder da equipe dona. */
export async function canOpenTask(tx: Reader, me: AuthCtx, task: Pick<Task, 'tenantId' | 'teamId' | 'assignedToId' | 'challengeId'>) {
  return canSee(me, task) || managesAttempt(tx, me, task)
}

/** Tentativa de desafio é do executor: nem o líder pausa ou conclui por ele. */
const canOperate = (me: AuthCtx, task: Task) => task.assignedToId === me.userId || (task.challengeId === null && canManage(me, task))

/** Tira o trabalho aberto de `userId` (só o de `teamId`, se dada). Tentativa de desafio é cancelada: o pool a ignora e ela ficaria órfã. */
export async function releaseOpenWork(tx: Tx, userId: string, teamId?: string, now = new Date()) {
  const inTeam = teamId ? eq(tasks.teamId, teamId) : undefined
  const owned = and(eq(tasks.assignedToId, userId), inOpen(), inTeam)
  await closeOpenLogs(tx, and(eq(taskTimeLogs.userId, userId), inTeam), now)
  await tx.update(tasks).set({ status: 'cancelled' }).where(and(owned, isNotNull(tasks.challengeId)))
  await tx.update(tasks).set({ status: 'pending', assignedToId: null }).where(and(owned, isNull(tasks.challengeId)))
}

/**
 * Trava o vínculo de quem inicia com a equipe da tarefa, no banco e não no contexto (que pode estar velho).
 * Sair da equipe apaga o vínculo e devolve o trabalho: com o vínculo travado, ou a saída espera esta transação, ou esta não acha o vínculo.
 * Vem antes de travar a tarefa para seguir a mesma ordem de removeMember (vínculo, depois tarefa) e não dar impasse.
 */
async function lockMembership(tx: Tx, me: AuthCtx, taskId: string) {
  if (isAdmin(me)) return
  const [link] = await tx
    .select({ userId: teamMembers.userId })
    .from(teamMembers)
    .innerJoin(tasks, eq(tasks.teamId, teamMembers.teamId))
    .where(and(eq(tasks.id, taskId), eq(tasks.tenantId, me.tenantId), eq(teamMembers.userId, me.userId)))
    .for('share', { of: teamMembers })
  if (!link) fail('Tarefa não encontrada')
}

export const startTaskFor = (me: AuthCtx, taskId: string, now = new Date()) => db.transaction((tx) => startTaskIn(tx, me, taskId, now))

/** A equipe cuja regra pontua a tarefa: a dona do desafio, na tentativa (que também precisa do acesso ao desafio), senão a da própria tarefa. */
async function scoringTeamOf(tx: Tx, me: AuthCtx, task: Task) {
  if (!task.challengeId) return task.teamId
  return (await accessibleChallenge(tx, me, task.challengeId)).teamId
}

/** Inicia (ou retoma / puxa do pool). Pausa qualquer outra tarefa do usuário. */
async function startTaskIn(tx: Tx, me: AuthCtx, taskId: string, now: Date) {
  // Antes de qualquer consulta que devolva dado da tarefa: fora do tenant ou da visibilidade, ela não existe.
  await lockMembership(tx, me, taskId)
  const loaded = await loadTask(tx, me, taskId)
  const scoringTeamId = await scoringTeamOf(tx, me, loaded)
  const [blocker] = await openBlockers(tx, [taskId]).limit(1)
  if (blocker) fail(`Bloqueada: depende de "${blocker.title}"`)
  const pausedIds = await closeOpenLogs(tx, eq(taskTimeLogs.userId, me.userId), now)
  if (pausedIds.length) {
    await tx.update(tasks).set({ status: 'paused' }).where(and(inArray(tasks.id, pausedIds), eq(tasks.status, 'in_progress')))
  }
  // A regra fica congelada no primeiro start. A linha está travada por loadTask, então ninguém inicia a tarefa entre a leitura e o UPDATE.
  const scoringSnapshot = loaded.startedAt ? undefined : await snapshotOfTeam(tx, me.tenantId, scoringTeamId)
  // Lock atômico: só pega se ainda estiver livre ou for minha.
  const [task] = await tx
    .update(tasks)
    .set({
      assignedToId: me.userId,
      status: 'in_progress',
      startedAt: sql`coalesce(${tasks.startedAt}, ${now.toISOString()}::timestamptz)`,
      scoringSnapshot,
    })
    .where(
      and(
        eq(tasks.id, taskId),
        eq(tasks.tenantId, me.tenantId),
        inArray(tasks.status, ['pending', 'paused']),
        or(isNull(tasks.assignedToId), eq(tasks.assignedToId, me.userId)),
      ),
    )
    .returning()
  if (!task) fail('Tarefa indisponível: já foi iniciada por outra pessoa ou concluída')
  await tx.insert(taskTimeLogs).values({ taskId, userId: me.userId, startedAt: now })
  return task
}

export async function pauseTaskFor(me: AuthCtx, taskId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const task = await loadTask(tx, me, taskId)
    if (task.status !== 'in_progress') fail('Tarefa não está em andamento')
    if (!canOperate(me, task)) forbid()
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
  scored: boolean
  manual: boolean
  isNewRecord: boolean
}

type FinishResult = Omit<FinishSummary, 'taskId' | 'taskTitle' | 'basePoints' | 'estimatedSeconds'>

const summaryOf = (task: Task, result: FinishResult): FinishSummary => ({
  taskId: task.id,
  taskTitle: task.title,
  basePoints: task.basePoints,
  estimatedSeconds: task.estimatedSeconds,
  ...result,
})

type Best = { seconds: number; userId: string }

/** O recorde atual do desafio (a melhor tentativa válida), ignorando `excludeTaskId`. */
async function challengeBest(tx: Tx, challengeId: string, excludeTaskId: string): Promise<Best | null> {
  const [best] = await tx
    .select({ seconds: sql<number>`${tasks.movingSeconds}`, userId: sql<string>`${tasks.assignedToId}` })
    .from(tasks)
    .where(and(eq(tasks.challengeId, challengeId), validAttempt, ne(tasks.id, excludeTaskId)))
    .orderBy(...bestFirst)
    .limit(1)
  return best ?? null
}

type RecordBreak = { challengeId: string; taskId: string; title: string; teamId: string; seconds: number; previous: Best; by: { id: string; name: string } }

/** O recorde mudou de mãos: audita e avisa o detentor anterior. O aviso sai em nome de quem bateu, mesmo quando é o gestor que aprova a tentativa. */
async function announceRecordBroken(tx: Tx, me: AuthCtx, record: RecordBreak) {
  await recordAudit(tx, me, {
    action: 'challenge.record_broken',
    entityType: 'challenge',
    entityId: record.challengeId,
    meta: { taskId: record.taskId, byUserId: record.by.id, teamId: record.teamId, seconds: record.seconds, previousSeconds: record.previous.seconds, previousHolderId: record.previous.userId },
  })
  await notify(tx, { userId: record.by.id, tenantId: me.tenantId }, {
    userIds: [record.previous.userId],
    type: 'challenge.record_broken',
    entityType: 'challenge',
    entityId: record.challengeId,
    payload: { taskTitle: record.title, by: record.by.name },
  })
}

type AttemptResult = { movingSeconds: number; scored: boolean; needsValidation: boolean; isNewRecord: boolean; previous: Best | null }

/** Audita a tentativa concluída e, se ela superou um recorde que já existia, anuncia a troca de mãos. */
async function recordAttemptFinished(tx: Tx, me: AuthCtx, attempt: Task & { challengeId: string }, result: AttemptResult) {
  const { movingSeconds, scored, needsValidation, isNewRecord, previous } = result
  await recordAudit(tx, me, {
    action: 'challenge.attempt_finished',
    entityType: 'challenge',
    entityId: attempt.challengeId,
    meta: { taskId: attempt.id, teamId: attempt.teamId, seconds: movingSeconds, scored, needsValidation, isNewRecord },
  })
  if (!isNewRecord || !previous) return
  await announceRecordBroken(tx, me, {
    challengeId: attempt.challengeId,
    taskId: attempt.id,
    title: attempt.title,
    teamId: attempt.teamId,
    seconds: movingSeconds,
    previous,
    by: { id: me.userId, name: me.name },
  })
}

/** Tentativa de desafio rende pontos até o limite diário de tentativas pontuadas; depois vale só pelo tempo e pelo recorde. */
async function rendersPoints(tx: Tx, task: Task, userId: string, now: Date) {
  if (!task.challengeId) return true
  const [challenge] = await tx.select({ perDay: challenges.scoredAttemptsPerDay }).from(challenges).where(eq(challenges.id, task.challengeId))
  const { timezone } = await tenantSettings(task.tenantId)
  const [done] = await tx
    .select({ n: count() })
    .from(tasks)
    .where(and(eq(tasks.challengeId, task.challengeId), eq(tasks.assignedToId, userId), scoringAttempt, sql`${localDay(tasks.finishedAt, timezone)} = ${localDayOf(now, timezone)}`))
  return done!.n < challenge!.perDay
}

export async function finishTaskFor(me: AuthCtx, taskId: string, now = new Date()): Promise<FinishSummary> {
  return db.transaction(async (tx) => {
    const task = await loadTask(tx, me, taskId)
    if (task.status !== 'in_progress' && task.status !== 'paused') fail('Tarefa não está em execução')
    if (!canOperate(me, task)) forbid()
    await closeOpenLogs(tx, eq(taskTimeLogs.taskId, taskId), now)
    const logs = await tx.select().from(taskTimeLogs).where(eq(taskTimeLogs.taskId, taskId)).orderBy(asc(taskTimeLogs.startedAt))
    const rules = effectiveRules(task.scoringSnapshot)
    const { movingSeconds, elapsedSeconds } = summarizeLogs(logs, task.estimatedSeconds, now, rules)
    const score = scoreTask({ basePoints: task.basePoints, estimatedSeconds: task.estimatedSeconds, movingSeconds, elapsedSeconds }, rules)
    const scored = await rendersPoints(tx, task, me.userId, now)
    const finalPoints = scored ? score.finalPoints : 0
    const previous = task.challengeId ? await challengeBest(tx, task.challengeId, task.id) : null
    const isNewRecord = task.challengeId !== null && !score.needsValidation && (previous === null || movingSeconds < previous.seconds)
    await tx
      .update(tasks)
      .set({
        status: 'finished',
        finishedAt: now,
        movingSeconds,
        elapsedSeconds,
        awardedPoints: finalPoints,
        needsValidation: score.needsValidation,
      })
      .where(eq(tasks.id, taskId))
    if (task.challengeId) {
      await recordAttemptFinished(tx, me, { ...task, challengeId: task.challengeId }, { movingSeconds, scored, needsValidation: score.needsValidation, isNewRecord, previous })
    }
    return summaryOf(task, { movingSeconds, elapsedSeconds, ...score, finalPoints, scored, manual: false, isNewRecord })
  })
}

const adminWithoutTeam = (me: AuthCtx) => isAdmin(me) && me.memberships.length === 0

/**
 * Tenta um desafio pela equipe `teamId` (ou pela única candidata): retoma minha tentativa aberta ou cria uma nova tarefa e inicia.
 * Tudo numa transação, segurando o desafio: tirar a equipe do compartilhamento espera esta tentativa e então a enxerga em aberto.
 */
export async function attemptChallengeFor(me: AuthCtx, challengeId: string, teamId?: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const { challenge, candidateTeamIds } = await lockChallengeForAttempt(tx, me, challengeId)
    const open = await findOpenAttempt(tx, me.userId, challenge.id)
    if (open) return startTaskIn(tx, me, open.id, now)
    if (adminWithoutTeam(me)) fail('Administradores sem equipe não competem')
    // O índice tasks_open_attempt_idx deixa passar uma tentativa aberta por pessoa; no clique duplo a segunda inserção vira no-op.
    const [created] = await tx
      .insert(tasks)
      .values({
        tenantId: challenge.tenantId,
        teamId: chooseAttemptTeam(candidateTeamIds, teamId),
        assignedToId: me.userId,
        createdById: me.userId,
        challengeId: challenge.id,
        title: challenge.title,
        description: challenge.description,
        basePoints: challenge.basePoints,
        estimatedSeconds: challenge.estimatedSeconds,
      })
      .onConflictDoNothing()
      .returning()
    const attempt = created ?? (await findOpenAttempt(tx, me.userId, challenge.id))
    if (!attempt) fail('Tentativa não encontrada, tente de novo')
    return startTaskIn(tx, me, attempt.id, now)
  })
}

async function findOpenAttempt(tx: Tx, userId: string, challengeId: string) {
  const [open] = await tx
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.challengeId, challengeId), eq(tasks.assignedToId, userId), inOpen()))
    .limit(1)
  return open
}

const manualResultOf = (task: Task): FinishResult => ({
  movingSeconds: task.estimatedSeconds,
  elapsedSeconds: task.estimatedSeconds,
  paceBonus: 0,
  overtimePenalty: 0,
  pausePenalty: 0,
  finalPoints: task.basePoints,
  needsValidation: false,
  scored: true,
  manual: true,
  isNewRecord: false,
})

/** Conclusão manual (Kanban): pontos base, sem cronômetro. */
export async function finishTaskManuallyFor(me: AuthCtx, taskId: string, now = new Date()): Promise<FinishSummary> {
  return db.transaction(async (tx) => {
    const task = await loadTask(tx, me, taskId)
    if (task.challengeId) fail('Tentativa de desafio não pode ser concluída manualmente')
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
    return summaryOf(task, manualResultOf(task))
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

/** Cancela (gestor; na tentativa de desafio, também o líder da equipe dona). Tempo fica pra métricas; pontos não. */
export async function cancelTaskFor(me: AuthCtx, taskId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const task = await lockTask(tx, me, taskId)
    if (!canManage(me, task) && !(await managesAttempt(tx, me, task))) denyAccess(me, task)
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

/** Na tentativa de desafio quem valida é o admin ou o líder da equipe dona (com `challenge.validate`), e nunca o próprio executor: a tarefa está na equipe de quem tentou, então a visibilidade comum não vale. */
async function assertCanValidateAttempt(tx: Tx, me: AuthCtx, task: Task) {
  const owner = await ownerTeamOf(tx, me.tenantId, task.challengeId)
  const mayValidate = task.assignedToId !== me.userId && owner !== null && canManageWith(me, 'challenge.validate', owner)
  if (!mayValidate) denyAccess(me, task)
}

/** A tentativa aprovada passa a valer; se superar o recorde, ele muda de mãos. Rejeitada nunca é recorde. */
async function announceApprovedRecord(tx: Tx, me: AuthCtx, attempt: Task) {
  const { challengeId, movingSeconds, assignedToId } = attempt
  if (!challengeId || movingSeconds === null || !assignedToId) return
  const previous = await challengeBest(tx, challengeId, attempt.id)
  if (!previous || movingSeconds >= previous.seconds) return
  const [by] = await tx.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, assignedToId))
  await announceRecordBroken(tx, me, { challengeId, taskId: attempt.id, title: attempt.title, teamId: attempt.teamId, seconds: movingSeconds, previous, by: by! })
}

/** Aprova ou rejeita pontos retidos (gestor; na tentativa de desafio, quem valida o desafio). */
export async function validatePointsFor(me: AuthCtx, taskId: string, approve: boolean, reason?: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const task = await lockTask(tx, me, taskId)
    if (task.challengeId) await assertCanValidateAttempt(tx, me, task)
    else if (!canManage(me, task)) denyAccess(me, task)
    if (task.status !== 'finished' || !task.needsValidation) fail('Tarefa não aguarda validação')
    const [updated] = await tx
      .update(tasks)
      .set({ needsValidation: false, awardedPoints: approve ? task.awardedPoints : 0, rejectedAt: approve ? null : now })
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
    if (approve) await announceApprovedRecord(tx, me, updated!)
    return updated!
  })
}

/** Cancelada volta a pendente com o mesmo responsável, ou ao pool se ele já não é membro ativo; os pontos já foram zerados ao cancelar. O board precisa seguir ativo e vinculado à equipe. */
export async function restoreTaskFor(me: AuthCtx, taskId: string) {
  return db.transaction(async (tx) => {
    const task = await loadTask(tx, me, taskId)
    if (!canManageWith(me, 'task.restore', task.teamId)) forbid()
    if (task.status !== 'cancelled') fail('Só tarefas canceladas podem ser restauradas')
    if (task.challengeId) fail('Tentativa de desafio cancelada não volta: a pessoa tenta de novo')
    if (task.boardId) await lockBoardForTask(tx, me, task.boardId, task.teamId)
    const keepsAssignee = task.assignedToId !== null && (await lockActiveMember(tx, { tenantId: me.tenantId, userId: task.assignedToId, teamId: task.teamId }))
    const [updated] = await tx.update(tasks).set({ status: 'pending', assignedToId: keepsAssignee ? task.assignedToId : null }).where(eq(tasks.id, taskId)).returning()
    await recordAudit(tx, me, {
      action: 'task.restored',
      entityType: 'task',
      entityId: taskId,
      changes: diffFields(task, updated!, ['status', 'assignedToId']),
    })
    return updated!
  })
}

/** A tarefa com o estado do player. O líder da equipe dona também abre a tentativa de outra equipe, para cancelar ou conferir. */
export async function taskDetailFor(me: AuthCtx, taskId: string) {
  const [row] = await db
    .select({ task: tasks, assigneeName: users.name })
    .from(tasks)
    .leftJoin(users, eq(users.id, tasks.assignedToId))
    .where(and(eq(tasks.id, taskId), eq(tasks.tenantId, me.tenantId)))
  if (!row) fail('Tarefa não encontrada')
  if (!(await canOpenTask(db, me, row.task))) fail('Tarefa não encontrada')
  return {
    ...row.task,
    assigneeName: row.assigneeName,
    blockedBy: await openBlockers(db, [row.task.id]),
    ...(await taskPlayerState(row.task.id, me.userId)),
    cap: capOfTask(row.task),
    isMine: row.task.assignedToId === me.userId,
    canManage: canManage(me, row.task),
    managesAttempt: await managesAttempt(db, me, row.task),
  }
}

/** Tarefa em andamento/pausada do usuário (HUD). */
export async function activeTaskFor(me: AuthCtx) {
  const rows = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.tenantId, me.tenantId), eq(tasks.assignedToId, me.userId), inArray(tasks.status, ['in_progress', 'paused'])))
    .orderBy(desc(sql`${tasks.status} = 'in_progress'`))
    .limit(1)
  const task = rows[0]
  if (!task) return null
  return { ...task, ...(await taskPlayerState(task.id, me.userId)), cap: capOfTask(task) }
}

/** O teto de abandono da tarefa, pela regra que ela guardou no primeiro start. */
export const capOfTask = (task: Pick<Task, 'estimatedSeconds' | 'scoringSnapshot'>) => capFor(task.estimatedSeconds, effectiveRules(task.scoringSnapshot))

/** Estado do player: acumulado fechado + bloco aberto (se meu). */
export async function taskPlayerState(taskId: string, userId: string) {
  const logs = await db.select().from(taskTimeLogs).where(eq(taskTimeLogs.taskId, taskId)).orderBy(desc(taskTimeLogs.startedAt))
  const accumulatedSeconds = logs.reduce((acc, l) => acc + (l.durationSeconds ?? 0), 0)
  const open = logs.find((l) => l.stoppedAt === null && l.userId === userId)
  return { accumulatedSeconds, activeStartedAt: open ? open.startedAt.toISOString() : null }
}

export type NewTask = {
  title: string
  description?: string
  basePoints: number
  estimatedMinutes: number
  teamId: string
  assignedToId: string | null
  opportunityId?: string
  /** Na edição, omitido mantém o board atual; nulo tira a tarefa do board. */
  boardId?: string | null
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
    if (data.boardId) await lockBoardForTask(tx, me, data.boardId, data.teamId)
    const [task] = await tx
      .insert(tasks)
      .values({
        tenantId: me.tenantId,
        teamId: data.teamId,
        assignedToId: data.assignedToId,
        opportunityId: data.opportunityId ?? null,
        boardId: data.boardId ?? null,
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
      meta: { title: task!.title, teamId: task!.teamId, assignedToId: task!.assignedToId, opportunityId: task!.opportunityId, boardId: task!.boardId },
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

const auditedTaskFields = ['title', 'description', 'basePoints', 'estimatedSeconds', 'priority', 'dueDate', 'scheduledStart', 'scheduledEnd', 'assignedToId', 'boardId'] as const

export async function updateTaskFor(me: AuthCtx, data: TaskEdit) {
  await db.transaction(async (tx) => {
    const task = await lockTask(tx, me, data.taskId)
    if (!canManage(me, task)) forbid()
    if (task.challengeId) fail('Tentativa de desafio não pode ser editada')
    if (task.status === 'finished' || task.status === 'cancelled') fail('Tarefa encerrada não pode ser editada')
    // Só quem passa a ser responsável é conferido: com a tarefa travada, travar o vínculo do atual inverteria a ordem de removeMember (vínculo, depois tarefa) e daria impasse.
    if (data.assignedToId && data.assignedToId !== task.assignedToId) await assertMember(tx, { tenantId: me.tenantId, userId: data.assignedToId, teamId: task.teamId })
    if (task.status !== 'pending' && data.assignedToId !== task.assignedToId) fail('Só tarefas pendentes podem ser reatribuídas')
    if (data.scheduledStart && data.scheduledEnd && data.scheduledEnd < data.scheduledStart) fail('Fim do cronograma antes do início')
    if (data.boardId && data.boardId !== task.boardId) await lockBoardForTask(tx, me, data.boardId, task.teamId)
    const [updated] = await tx
      .update(tasks)
      .set({
        boardId: data.boardId,
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

/** `boardId` é o id do board ou `NO_BOARD` para as tarefas fora de qualquer board. */
export type TaskListFilters = { teamId?: string; assigneeId?: string; priority?: Priority; search?: string; boardId?: string }

const boardFilter = (boardId?: string) => (boardId === NO_BOARD ? isNull(tasks.boardId) : boardId ? eq(tasks.boardId, boardId) : undefined)

/** Escopo de visibilidade compartilhado entre a lista do board e a exportação. O board filtra, não amplia: tarefa de equipe alheia continua invisível. */
export function taskListWhere(me: AuthCtx, filters: TaskListFilters, capability?: Capability) {
  return and(
    eq(tasks.tenantId, me.tenantId),
    inTeams(tasks.teamId, me, { only: filters.teamId, capability }),
    isNull(tasks.challengeId),
    boardFilter(filters.boardId),
    filters.assigneeId === 'pool' ? isNull(tasks.assignedToId) : filters.assigneeId ? eq(tasks.assignedToId, filters.assigneeId) : undefined,
    filters.priority ? eq(tasks.priority, filters.priority) : undefined,
    filters.search ? or(ilike(tasks.title, `%${filters.search}%`), ilike(tasks.description, `%${filters.search}%`)) : undefined,
  )
}

export function boardMembersFor(me: AuthCtx, teamId?: string) {
  return db.select({ id: users.id, name: users.name }).from(users).where(usersInScope(me, { only: teamId })).orderBy(asc(users.name))
}

export async function taskFormOptionsFor(me: AuthCtx) {
  const teamList = await db
    .select({ id: teams.id, name: teams.name })
    .from(teams)
    .where(and(eq(teams.tenantId, me.tenantId), inManagedTeams(teams.id, me)))
    .orderBy(asc(teams.name))
  return { teams: teamList, members: await activeMembersByTeam(db, me.tenantId, teamList.map((t) => t.id)) }
}
