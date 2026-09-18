import { eq } from 'drizzle-orm'
import { db } from '#/db'
import { invitations, teams, tenants } from '#/db/schema'
import { auth } from '#/lib/auth'
import { sendMail } from './mail'

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
