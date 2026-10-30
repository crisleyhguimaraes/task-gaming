import { eq } from 'drizzle-orm'
import { db } from '#/db'
import { users } from '#/db/schema'
import type { AuditAction } from '#/lib/audit'
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

/** Quem redefine por email acabou de escolher a senha: a troca obrigatória da senha temporária deixa de valer. */
export async function completePasswordReset(userId: string) {
  const user = await findUser(eq(users.id, userId))
  if (!user) return
  await db.transaction(async (tx) => {
    await tx.update(users).set({ mustChangePassword: false }).where(eq(users.id, user.id))
    await recordAudit(tx, { userId: user.id, name: user.name, tenantId: user.tenantId, impersonatedBy: null }, { action: 'auth.password_reset', entityType: 'user', entityId: user.id })
  })
}

/** Um login só começa quando a sessão fica de pé: a do desafio de 2FA e a trocada ao ativar/desativar 2FA não contam. */
export async function opensLoginSession(userId: string, path: string | undefined, hadSession: boolean) {
  if (path?.startsWith('/two-factor/')) return !hadSession
  if (!path?.startsWith('/sign-in/')) return true
  const user = await findUser(eq(users.id, userId))
  return !user?.twoFactorEnabled
}

const twoFactorActionByPath: Record<string, AuditAction> = {
  '/two-factor/verify-totp': 'auth.two_factor_enabled',
  '/two-factor/disable': 'auth.two_factor_disabled',
}

/** Só estes dois endpoints do plugin mexem em `two_factor_enabled` de uma sessão já autenticada. */
export async function recordTwoFactorChanged(path: string | undefined, userId: string) {
  const action = path && twoFactorActionByPath[path]
  if (!action) return
  const user = await findUser(eq(users.id, userId))
  if (!user) return
  await recordAudit(db, { userId: user.id, name: user.name, tenantId: user.tenantId, impersonatedBy: null }, { action, entityType: 'user', entityId: user.id })
}
