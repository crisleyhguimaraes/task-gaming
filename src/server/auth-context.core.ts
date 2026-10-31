import { asc, eq } from 'drizzle-orm'
import { db } from '#/db'
import { teamMembers } from '#/db/schema'
import type { Role } from '#/lib/access'
import { overridesByTeamRole } from './permissions.core'
import type { AuthCtx } from './roles'

type SessionUser = { id: string; tenantId: string; role: Role; name: string; mustChangePassword?: boolean | null }
type Session = { impersonatedBy?: string | null }

const membershipsOf = (userId: string) =>
  db
    .select({ teamId: teamMembers.teamId, role: teamMembers.role })
    .from(teamMembers)
    .where(eq(teamMembers.userId, userId))
    .orderBy(asc(teamMembers.createdAt), asc(teamMembers.teamId))

/** Sem cache: o vínculo e os overrides valem na próxima requisição, como a sessão sempre valeu. */
export async function loadAuthCtx(user: SessionUser, session: Session): Promise<AuthCtx> {
  const [memberships, capabilityOverrides] = await Promise.all([membershipsOf(user.id), overridesByTeamRole(user.tenantId)])
  return {
    userId: user.id,
    tenantId: user.tenantId,
    teamId: memberships[0]?.teamId ?? null,
    role: user.role,
    memberships,
    name: user.name,
    impersonatedBy: session.impersonatedBy ?? null,
    mustChangePassword: user.mustChangePassword ?? false,
    capabilityOverrides,
  }
}
