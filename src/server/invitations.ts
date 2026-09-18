import { randomBytes } from 'node:crypto'
import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '#/db'
import { invitations, teams, users } from '#/db/schema'
import { authMiddleware, requireRole } from './auth-context'
import type { AuthCtx } from './roles'
import { isAdmin } from './roles'
import { acceptInvitationCore, sendInvitation as send, validInvitation } from './invitations.core'

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000
const scope = (me: AuthCtx) =>
  isAdmin(me) ? eq(invitations.tenantId, me.tenantId) : and(eq(invitations.tenantId, me.tenantId), eq(invitations.teamId, me.teamId ?? ''))

export const listInvitations = createServerFn()
  .middleware([authMiddleware])
  .handler(async ({ context: { auth: me } }) => {
    requireRole(me, 'SUPER_ADMIN', 'TENANT_ADMIN', 'TEAM_LEADER')
    return db
      .select({ id: invitations.id, email: invitations.email, role: invitations.role, teamName: teams.name, expiresAt: invitations.expiresAt, createdAt: invitations.createdAt })
      .from(invitations)
      .leftJoin(teams, eq(teams.id, invitations.teamId))
      .where(and(scope(me), isNull(invitations.acceptedAt)))
      .orderBy(desc(invitations.createdAt))
  })

export const createInvitation = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ email: z.email(), teamId: z.uuid().nullable(), role: z.enum(['TENANT_ADMIN', 'TEAM_LEADER', 'MEMBER']) }))
  .handler(async ({ data, context: { auth: me } }) => {
    requireRole(me, 'SUPER_ADMIN', 'TENANT_ADMIN', 'TEAM_LEADER')
    if (me.role === 'TEAM_LEADER' && (data.role !== 'MEMBER' || data.teamId !== me.teamId)) throw new Error('Líder só convida membros da própria equipe')
    const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.email, data.email))
    if (exists) throw new Error('Este email já tem conta')
    // reenvio: substitui convite pendente do mesmo email
    await db.delete(invitations).where(and(eq(invitations.tenantId, me.tenantId), eq(invitations.email, data.email), isNull(invitations.acceptedAt)))
    const [inv] = await db
      .insert(invitations)
      .values({
        tenantId: me.tenantId,
        teamId: data.teamId,
        email: data.email,
        role: data.role,
        token: randomBytes(32).toString('hex'),
        invitedById: me.userId,
        expiresAt: new Date(Date.now() + SEVEN_DAYS),
      })
      .returning()
    await send(inv!)
  })

export const resendInvitation = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ invitationId: z.uuid() }))
  .handler(async ({ data, context: { auth: me } }) => {
    requireRole(me, 'SUPER_ADMIN', 'TENANT_ADMIN', 'TEAM_LEADER')
    const [inv] = await db
      .update(invitations)
      .set({ token: randomBytes(32).toString('hex'), expiresAt: new Date(Date.now() + SEVEN_DAYS) })
      .where(and(eq(invitations.id, data.invitationId), scope(me), isNull(invitations.acceptedAt)))
      .returning()
    if (!inv) throw new Error('Convite não encontrado')
    await send(inv)
  })

export const cancelInvitation = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ invitationId: z.uuid() }))
  .handler(async ({ data, context: { auth: me } }) => {
    requireRole(me, 'SUPER_ADMIN', 'TENANT_ADMIN', 'TEAM_LEADER')
    await db.delete(invitations).where(and(eq(invitations.id, data.invitationId), scope(me), isNull(invitations.acceptedAt)))
  })

// --- Públicas (sem sessão) --------------------------------------------------
export const getInvitation = createServerFn()
  .validator(z.object({ token: z.string().min(10) }))
  .handler(async ({ data }) => {
    const r = await validInvitation(data.token)
    return r.status === 'valid' ? { status: r.status, email: r.inv.email, tenantName: r.tenantName, teamName: r.teamName } : { status: r.status }
  })

export const acceptInvitation = createServerFn({ method: 'POST' })
  .validator(z.object({ token: z.string().min(10), name: z.string().trim().min(2).max(120), password: z.string().min(8) }))
  .handler(({ data }) => acceptInvitationCore(data.token, data.name, data.password))
