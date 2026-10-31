import { randomBytes } from 'node:crypto'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { db } from '#/db'
import { invitations, teams, tenants, users } from '#/db/schema'
import type { AssignableRole, TeamRole } from '#/lib/access'
import { auth } from '#/lib/auth'
import { recordAudit } from './audit.core'
import { sendMail } from './mail'
import type { AuthCtx } from './roles'
import { fail, requireCan } from './roles'
import { assertWithinScope, inTenantTeams, teamIdsFrom } from './scope'
import { assertTeamInTenant } from './teams.core'
import { addMember } from './team-members.core'

export const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000

export const invitationScope = (me: AuthCtx) => inTenantTeams(invitations, me)

export async function listInvitationsFor(me: AuthCtx) {
  requireCan(me, 'invitation.manage')
  return db
    .select({ id: invitations.id, email: invitations.email, role: invitations.role, teamRole: invitations.teamRole, teamName: teams.name, expiresAt: invitations.expiresAt, createdAt: invitations.createdAt })
    .from(invitations)
    .leftJoin(teams, eq(teams.id, invitations.teamId))
    .where(and(invitationScope(me), isNull(invitations.acceptedAt)))
    .orderBy(desc(invitations.createdAt))
}

const newToken = () => randomBytes(32).toString('hex')
const newExpiry = () => new Date(Date.now() + SEVEN_DAYS)

export async function createInvitationCore(me: AuthCtx, data: { email: string; teamId: string | null; role: AssignableRole; teamRole?: TeamRole }) {
  const { teamRole = 'MEMBER' } = data
  assertWithinScope(me, { role: data.role, teamRole, teamIds: teamIdsFrom(data.teamId) }, 'invitation.manage')
  await assertTeamInTenant(db, me.tenantId, data.teamId)
  const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.email, data.email))
  if (exists) fail('Este email já tem conta')
  const inv = await db.transaction(async (tx) => {
    await tx.delete(invitations).where(and(eq(invitations.tenantId, me.tenantId), eq(invitations.email, data.email), isNull(invitations.acceptedAt)))
    const [created] = await tx
      .insert(invitations)
      .values({ tenantId: me.tenantId, teamId: data.teamId, email: data.email, role: data.role, teamRole, token: newToken(), invitedById: me.userId, expiresAt: newExpiry() })
      .returning()
    await recordAudit(tx, me, { action: 'invitation.created', entityType: 'invitation', entityId: created!.id, meta: { email: data.email, role: data.role, teamId: data.teamId, teamRole } })
    return created!
  })
  await sendInvitation(inv)
  return inv
}

export async function resendInvitationFor(me: AuthCtx, invitationId: string) {
  const inv = await db.transaction(async (tx) => {
    const [renewed] = await tx
      .update(invitations)
      .set({ token: newToken(), expiresAt: newExpiry() })
      .where(and(eq(invitations.id, invitationId), invitationScope(me), isNull(invitations.acceptedAt)))
      .returning()
    if (!renewed) fail('Convite não encontrado')
    await recordAudit(tx, me, { action: 'invitation.resent', entityType: 'invitation', entityId: renewed.id, meta: { email: renewed.email } })
    return renewed
  })
  await sendInvitation(inv)
}

export async function cancelInvitationFor(me: AuthCtx, invitationId: string) {
  await db.transaction(async (tx) => {
    const [removed] = await tx
      .delete(invitations)
      .where(and(eq(invitations.id, invitationId), invitationScope(me), isNull(invitations.acceptedAt)))
      .returning()
    if (removed) await recordAudit(tx, me, { action: 'invitation.cancelled', entityType: 'invitation', entityId: removed.id, meta: { email: removed.email } })
  })
}

export async function sendInvitation(inv: typeof invitations.$inferSelect) {
  const [tenant] = await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, inv.tenantId))
  const link = `${process.env.BETTER_AUTH_URL ?? 'http://localhost:3100'}/invite/${inv.token}`
  await sendMail(
    inv.email,
    `Convite para ${tenant?.name ?? 'Task Gaming'}`,
    `<p>Você foi convidado(a) para a equipe de <b>${tenant?.name ?? ''}</b> no Task Gaming.</p><p><a href="${link}">Aceitar convite</a> (válido por 7 dias)</p>`,
  )
}

export async function validInvitation(token: string) {
  const [row] = await db
    .select({ inv: invitations, tenantName: tenants.name, teamName: teams.name })
    .from(invitations)
    .innerJoin(tenants, eq(tenants.id, invitations.tenantId))
    .leftJoin(teams, eq(teams.id, invitations.teamId))
    .where(eq(invitations.token, token))
  if (!row) return { status: 'invalid' as const }
  if (row.inv.acceptedAt) return { status: 'accepted' as const }
  if (row.inv.expiresAt < new Date()) return { status: 'expired' as const }
  return { status: 'valid' as const, ...row }
}

// Convites gravados antes da migração 0013 carregam o papel de líder em `role`.
const rolesOf = ({ role, teamRole }: typeof invitations.$inferSelect) =>
  role === 'TEAM_LEADER' ? ({ role: 'MEMBER', teamRole: 'LEADER' } as const) : ({ role, teamRole } as const)

export async function acceptInvitationCore(token: string, name: string, password: string) {
  const r = await validInvitation(token)
  if (r.status !== 'valid') throw new Error('Convite inválido ou expirado')
  const { role, teamRole } = rolesOf(r.inv)
  const { user } = await auth.api.createUser({
    body: { name, email: r.inv.email, password, role, data: { tenantId: r.inv.tenantId, mustChangePassword: false } },
  })
  const actor = { userId: user.id, tenantId: r.inv.tenantId, name, impersonatedBy: null }
  await db.transaction(async (tx) => {
    await tx.update(invitations).set({ acceptedAt: new Date() }).where(eq(invitations.id, r.inv.id))
    if (r.inv.teamId) await addMember(tx, actor, { teamId: r.inv.teamId, userId: user.id, role: teamRole })
    await recordAudit(tx, actor, { action: 'invitation.accepted', entityType: 'invitation', entityId: r.inv.id, meta: { email: r.inv.email } })
  })
  return { email: r.inv.email }
}
