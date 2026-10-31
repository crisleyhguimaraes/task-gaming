import { and, asc, eq } from 'drizzle-orm'
import { db } from '#/db'
import { leads, notes, opportunities, tasks, users } from '#/db/schema'
import { recordAudit } from './audit.core'
import { notify } from './notifications.core'
import type { AuthCtx } from './roles'
import { canAccessTeam, fail } from './roles'
import { canOpenTask } from './tasks.core'
import type { Tx } from './tx'

export type NoteTarget = { type: 'task' | 'lead' | 'opportunity'; id: string }

const MAX_BODY = 2000

const noteKey = { task: 'taskId', lead: 'leadId', opportunity: 'opportunityId' } as const

/** A equipe de lead e oportunidade: quem pode abrir o registro é quem acessa a equipe, não o dono. */
const teamOf: Record<Exclude<NoteTarget['type'], 'task'>, (tenantId: string, id: string) => Promise<{ teamId: string } | undefined>> = {
  lead: async (tenantId, id) => (await db.select({ teamId: leads.teamId }).from(leads).where(and(eq(leads.id, id), eq(leads.tenantId, tenantId))))[0],
  opportunity: async (tenantId, id) =>
    (await db.select({ teamId: opportunities.teamId }).from(opportunities).where(and(eq(opportunities.id, id), eq(opportunities.tenantId, tenantId))))[0],
}

async function canOpenTarget(me: AuthCtx, { type, id }: NoteTarget) {
  if (type === 'task') {
    const [task] = await db
      .select({ tenantId: tasks.tenantId, teamId: tasks.teamId, assignedToId: tasks.assignedToId, challengeId: tasks.challengeId })
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.tenantId, me.tenantId)))
    return task !== undefined && (await canOpenTask(db, me, task))
  }
  const record = await teamOf[type](me.tenantId, id)
  return record !== undefined && canAccessTeam(me, record.teamId)
}

async function assertVisible(me: AuthCtx, target: NoteTarget) {
  if (!(await canOpenTarget(me, target))) fail('Registro não encontrado')
}

export async function addNoteFor(me: AuthCtx, target: NoteTarget, rawBody: string) {
  const body = rawBody.trim()
  if (!body) fail('Escreva alguma coisa')
  if (body.length > MAX_BODY) fail(`A nota aceita até ${MAX_BODY} caracteres`)
  await assertVisible(me, target)
  return db.transaction(async (tx) => {
    const [note] = await tx
      .insert(notes)
      .values({ tenantId: me.tenantId, authorId: me.userId, body, [noteKey[target.type]]: target.id })
      .returning()
    await recordAudit(tx, me, { action: 'note.created', entityType: target.type, entityId: target.id, meta: { noteId: note!.id } })
    if (target.type === 'task') await notifyTaskNote(tx, me, target.id)
    return note!
  })
}

async function notifyTaskNote(tx: Tx, me: AuthCtx, taskId: string) {
  const [task] = await tx
    .select({ title: tasks.title, assignedToId: tasks.assignedToId, createdById: tasks.createdById })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.tenantId, me.tenantId)))
  if (!task) return
  await notify(tx, me, {
    userIds: [task.assignedToId, task.createdById],
    type: 'note.created',
    entityType: 'task',
    entityId: taskId,
    payload: { taskTitle: task.title, by: me.name },
  })
}

export async function listNotesFor(me: AuthCtx, target: NoteTarget) {
  await assertVisible(me, target)
  return db
    .select({ id: notes.id, body: notes.body, createdAt: notes.createdAt, authorId: notes.authorId, authorName: users.name })
    .from(notes)
    .leftJoin(users, eq(users.id, notes.authorId))
    .where(and(eq(notes.tenantId, me.tenantId), eq(notes[noteKey[target.type]], target.id)))
    .orderBy(asc(notes.createdAt), asc(notes.id))
}
