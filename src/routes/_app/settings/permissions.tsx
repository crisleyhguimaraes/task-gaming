import { createFileRoute } from '@tanstack/react-router'
import { useAct } from '#/components/useAttempt'
import type { TeamRole } from '#/lib/access'
import { teamRoles } from '#/lib/access'
import { getCapabilityOverrides, setCapability } from '#/server/permissions'
import type { Capability } from '#/server/roles'
import { capabilities, defaultGrants, nonDelegableCapabilities, teamRoleCan } from '#/server/roles'

export const Route = createFileRoute('/_app/settings/permissions')({
  loader: () => getCapabilityOverrides(),
  component: Permissions,
})

const capabilityLabel: Record<Capability, string> = {
  'tenant.manage': 'Gerenciar tenants',
  'tenant.configure': 'Configurar o tenant',
  'team.manage': 'Gerenciar equipes',
  'goal.configure': 'Criar e vincular metas',
  'scoring.configure': 'Criar e vincular pontuações',
  'board.manage': 'Gerenciar boards (o líder só os das próprias equipes)',
  'team.link': 'Vincular pipelines e boards às equipes',
  'team.member.manage': 'Adicionar pessoas já cadastradas à equipe (o líder só como membro)',
  'user.read': 'Ver usuários',
  'user.create': 'Criar usuários',
  'user.update': 'Alterar o papel de usuários no tenant',
  'user.deactivate': 'Desativar e reativar usuários',
  'invitation.manage': 'Gerenciar convites',
  'permissions.manage': 'Gerenciar permissões',
  'audit.read': 'Ver a auditoria',
  'task.restore': 'Restaurar tarefas canceladas',
  'export.csv': 'Exportar CSV',
  'pipeline.configure': 'Configurar o funil',
  'challenge.write': 'Criar desafios na própria equipe',
  'challenge.share': 'Compartilhar desafios com outras equipes (o líder só com as próprias)',
  'challenge.validate': 'Validar pontos de tentativas de desafio (só vale para quem lidera a equipe dona)',
  'lead.write': 'Criar e editar leads',
  'lead.import': 'Importar leads',
  'opportunity.write': 'Criar e editar oportunidades',
  'opportunity.reopen': 'Reabrir oportunidades',
}

const roleColumn: Record<TeamRole, string> = { LEADER: 'Como líder da equipe', MEMBER: 'Como membro' }
const tenantCapabilities = capabilities.filter((c) => c !== 'tenant.manage')

function Permissions() {
  const overrides = Route.useLoaderData()
  const { error, act } = useAct()
  const toggle = (role: TeamRole, capability: Capability, allowed: boolean) => act(() => setCapability({ data: { role, capability, allowed } }))

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-neutral-400">Configurações</p>
        <h1 className="text-2xl font-bold tracking-tight">Permissões</h1>
        <p className="mt-1 text-sm text-neutral-500">O que a pessoa pode fazer em cada equipe, conforme o papel dela naquela equipe. Quem é líder numa equipe e membro em outra tem os poderes de cada papel só na respectiva equipe. Gestores gerais sempre mantêm o padrão, para ninguém trancar o próprio acesso.</p>
      </div>
      {error && <p className="text-sm text-rose-400">{error}</p>}
      <div className="overflow-x-auto rounded-2xl border border-neutral-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-800 text-left text-xs text-neutral-400">
              <th className="px-4 py-2.5 font-medium">Permissão</th>
              <th className="px-3 py-2.5 text-center font-medium">Gestor geral</th>
              {teamRoles.map((role) => <th key={role} className="px-3 py-2.5 text-center font-medium">{roleColumn[role]}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800">
            {tenantCapabilities.map((capability) => (
              <tr key={capability}>
                <td className="px-4 py-2.5">{capabilityLabel[capability]}</td>
                <td className="px-3 py-2.5 text-center">
                  <input type="checkbox" checked={defaultGrants[capability].includes('TENANT_ADMIN')} disabled aria-label={`${capabilityLabel[capability]}: gestor geral`} className="h-4 w-4 p-0 accent-xp-400" />
                </td>
                {teamRoles.map((role) => (
                  <td key={role} className="px-3 py-2.5 text-center">
                    <input
                      type="checkbox"
                      checked={teamRoleCan(role, capability, overrides)}
                      disabled={nonDelegableCapabilities.includes(capability)}
                      onChange={(e) => toggle(role, capability, e.target.checked)}
                      aria-label={`${capabilityLabel[capability]}: ${roleColumn[role]}`}
                      className="h-4 w-4 p-0 accent-xp-400"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
