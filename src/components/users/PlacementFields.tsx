import { teamRoles } from '#/lib/access'
import { roleLabel } from '#/lib/format'
import type { AuthCtx } from '#/server/roles'
import { isAdmin } from '#/server/roles'
import type { Team } from './model'
import { teamRoleLabel, teamsWhereCan } from './model'

type Props = { me: AuthCtx; teams: ReadonlyArray<Team>; capability: 'user.create' | 'invitation.manage' }

/** Papel de tenant e papel de equipe só o admin escolhe; quem lidera só põe membro, numa equipe que lidera. */
export function PlacementFields({ me, teams, capability }: Props) {
  const admin = isAdmin(me)
  const options = teamsWhereCan(me, teams, capability)
  return (
    <>
      <div className="space-y-1">
        <label htmlFor="teamId">Equipe</label>
        <select id="teamId" name="teamId">
          {admin && <option value="">Sem equipe</option>}
          {options.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      {admin && (
        <>
          <div className="space-y-1">
            <label htmlFor="teamRole">Papel na equipe</label>
            <select id="teamRole" name="teamRole" defaultValue="MEMBER">
              {teamRoles.map((r) => <option key={r} value={r}>{teamRoleLabel[r]}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="role">Papel na organização</label>
            <select id="role" name="role" defaultValue="MEMBER">
              <option value="MEMBER">{roleLabel.MEMBER}</option>
              <option value="TENANT_ADMIN">{roleLabel.TENANT_ADMIN}</option>
            </select>
          </div>
        </>
      )}
    </>
  )
}
