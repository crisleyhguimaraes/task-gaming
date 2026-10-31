import { and, asc, eq } from 'drizzle-orm'
import { db } from '#/db'
import { leads, notes, opportunities, tasks, users } from '#/db/schema'
import { recordAudit } from './audit.core'
import { notify } from './notifications.core'
import type { AuthCtx } from './roles'
import { canSee, fail } from './roles'
import type { Tx } from './tx'

export type NoteTarget = { type: 'task' | 'lead' | 'opportunity'; id: string }

const MAX_BODY = 2000

const noteKey = { task: 'taskId', lead: 'leadId', opportunity: 'opportunityId' } as const

type Visibility = { teamId: string; assignedToId: string | null }

/** Equipe e responsável de cada tipo de alvo, para reaproveitar a regra canSee de tarefas. */
const visibilityOf: Record<NoteTarget['type'], (tenantId: string, id: string) => Promise<Visibility | undefined>> = {
  task: async (tenantId, id) =>
    (await db.select({ teamId: tasks.teamId, assignedToId: tasks.assignedToId }).from(tasks).where(and(eq(tasks.id, id), eq(tasks.tenantId, tenantId))))[0],
  lead: async (tenantId, id) =>
    (await db.select({ teamId: leads.teamId, assignedToId: leads.ownerId }).from(leads).where(and(eq(leads.id, id), eq(leads.tenantId, tenantId))))[0],
  opportunity: async (tenantId, id) =>
    (await db.select({ teamId: opportunities.teamId, assignedToId: opportunities.ownerId }).from(opportunities).where(and(eq(opportunities.id, id), eq(opportunities.tenantId, tenantId))))[0],
}

async function assertVisible(me: AuthCtx, { type, id }: NoteTarget) {
  const target = await visibilityOf[type](me.tenantId, id)
  if (!target || !canSee(me, target)) fail('Registro não encontrado')
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
