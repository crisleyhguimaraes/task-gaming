import { createFileRoute, useRouter } from '@tanstack/react-router'
import * as React from 'react'
import { getCapabilityOverrides, setCapability } from '#/server/permissions'
import type { Capability, OverridableRole } from '#/server/roles'
import { can, capabilities, nonDelegableCapabilities, overridableRoles } from '#/server/roles'

export const Route = createFileRoute('/_app/settings/permissions')({
  loader: () => getCapabilityOverrides(),
  component: Permissions,
})

const capabilityLabel: Record<Capability, string> = {
  'tenant.manage': 'Gerenciar tenants',
  'tenant.configure': 'Configurar o tenant',
  'team.manage': 'Gerenciar equipes',
  'user.read': 'Ver usuários',
  'user.create': 'Criar usuários',
  'user.update': 'Alterar equipe e papel de usuários',
  'user.deactivate': 'Desativar e reativar usuários',
  'invitation.manage': 'Gerenciar convites',
  'permissions.manage': 'Gerenciar permissões',
  'audit.read': 'Ver a auditoria',
  'task.restore': 'Restaurar tarefas canceladas',
  'export.csv': 'Exportar CSV',
  'pipeline.configure': 'Configurar o funil',
  'lead.write': 'Criar e editar leads',
  'lead.import': 'Importar leads',
  'opportunity.write': 'Criar e editar oportunidades',
  'opportunity.reopen': 'Reabrir oportunidades',
}

const roleColumn: Record<OverridableRole, string> = { TEAM_LEADER: 'Líder de equipe', MEMBER: 'Membro' }
const tenantCapabilities = capabilities.filter((c) => c !== 'tenant.manage')

function Permissions() {
  const overrides = Route.useLoaderData()
  const router = useRouter()
  const [error, setError] = React.useState<string | null>(null)

  async function toggle(role: OverridableRole, capability: Capability, allowed: boolean) {
    try {
      await setCapability({ data: { role, capability, allowed } })
      setError(null)
      router.invalidate()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro')
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-neutral-400">Configurações</p>
        <h1 className="text-2xl font-bold tracking-tight">Permissões</h1>
        <p className="mt-1 text-sm text-neutral-500">O que líderes e membros podem fazer neste tenant. Gestores gerais sempre mantêm o padrão, para ninguém trancar o próprio acesso.</p>
      </div>
      {error && <p className="text-sm text-rose-400">{error}</p>}
      <div className="overflow-x-auto rounded-2xl border border-neutral-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-800 text-left text-xs text-neutral-400">
              <th className="px-4 py-2.5 font-medium">Permissão</th>
              <th className="px-3 py-2.5 text-center font-medium">Gestor geral</th>
              {overridableRoles.map((role) => <th key={role} className="px-3 py-2.5 text-center font-medium">{roleColumn[role]}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800">
            {tenantCapabilities.map((capability) => (
              <tr key={capability}>
                <td className="px-4 py-2.5">{capabilityLabel[capability]}</td>
                <td className="px-3 py-2.5 text-center">
                  <input type="checkbox" checked={can({ role: 'TENANT_ADMIN' }, capability)} disabled aria-label={`${capabilityLabel[capability]}: gestor geral`} className="h-4 w-4 p-0 accent-xp-400" />
                </td>
                {overridableRoles.map((role) => (
                  <td key={role} className="px-3 py-2.5 text-center">
                    <input
                      type="checkbox"
                      checked={can({ role, capabilityOverrides: overrides[role] }, capability)}
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
