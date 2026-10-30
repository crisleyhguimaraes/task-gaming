import { randomBytes } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '#/db'
import type { Role } from '#/db/schema'
import { invitations, teams, tenants, users } from '#/db/schema'
import { auth } from '#/lib/auth'
import { sendMail } from './mail'
import type { AuthCtx } from './roles'
import { fail } from './roles'
import { assertTeamInTenant } from './teams.core'

export const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000

export async function createInvitationCore(me: AuthCtx, data: { email: string; teamId: string | null; role: Exclude<Role, 'SUPER_ADMIN'> }) {
  if (me.role === 'TEAM_LEADER' && (data.role !== 'MEMBER' || data.teamId !== me.teamId)) fail('Líder só convida membros da própria equipe')
  await assertTeamInTenant(db, me.tenantId, data.teamId)
  const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.email, data.email))
  if (exists) fail('Este email já tem conta')
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
  await sendInvitation(inv!)
  return inv!
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

export async function acceptInvitationCore(token: string, name: string, password: string) {
  const r = await validInvitation(token)
  if (r.status !== 'valid') throw new Error('Convite inválido ou expirado')
  await auth.api.createUser({
    body: {
      name,
      email: r.inv.email,
      password,
      role: r.inv.role,
      data: { tenantId: r.inv.tenantId, teamId: r.inv.teamId ?? undefined, mustChangePassword: false },
    },
  })
  await db.update(invitations).set({ acceptedAt: new Date() }).where(eq(invitations.id, r.inv.id))
  return { email: r.inv.email }
}
