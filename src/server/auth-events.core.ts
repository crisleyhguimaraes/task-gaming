import { eq } from 'drizzle-orm'
import { db } from '#/db'
import { users } from '#/db/schema'
import { recordAudit } from './audit.core'

const findUser = async (where: ReturnType<typeof eq>) => (await db.select().from(users).where(where))[0]

export async function recordSessionStarted(session: { userId: string; impersonatedBy?: string | null }) {
  const user = await findUser(eq(users.id, session.userId))
  if (!user) return
  const impersonator = session.impersonatedBy ? await findUser(eq(users.id, session.impersonatedBy)) : undefined
  if (session.impersonatedBy && !impersonator) return
  await recordAudit(
    db,
    { userId: impersonator?.id ?? user.id, name: impersonator?.name ?? user.name, tenantId: user.tenantId, impersonatedBy: null },
    { action: impersonator ? 'impersonation.started' : 'auth.login', entityType: 'user', entityId: user.id },
  )
}

export async function recordImpersonationStopped(session: { userId: string; impersonatedBy?: string | null }) {
  if (!session.impersonatedBy) return
  const [target, impersonator] = await Promise.all([findUser(eq(users.id, session.userId)), findUser(eq(users.id, session.impersonatedBy))])
  if (!target || !impersonator) return
  await recordAudit(
    db,
    { userId: impersonator.id, name: impersonator.name, tenantId: target.tenantId, impersonatedBy: null },
    { action: 'impersonation.stopped', entityType: 'user', entityId: target.id },
  )
}

/** Só registra quando o email existe: sem usuário não há tenant a quem atribuir o evento. */
export async function recordLoginFailed(email: string) {
  const user = await findUser(eq(users.email, email))
  if (!user) return
  await recordAudit(db, { userId: user.id, name: user.name, tenantId: user.tenantId, impersonatedBy: null }, { action: 'auth.login_failed', entityType: 'user', entityId: user.id })
}
