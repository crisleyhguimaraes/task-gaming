// Dados de demonstração no tenant "acme": equipe Vendas com líder + 2 membros e tarefas.
import { and, eq } from 'drizzle-orm'
import { db } from './index'
import { tasks, teams, tenants, users } from './schema'
import { auth } from '#/lib/auth'
import { addMember, teamRoleOf } from '#/server/team-members.core'

const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, 'acme'))
if (!tenant) throw new Error('Crie o tenant "acme" primeiro (/admin/tenants)')

let [team] = await db.select().from(teams).where(and(eq(teams.tenantId, tenant.id), eq(teams.name, 'Vendas')))
if (!team) [team] = await db.insert(teams).values({ tenantId: tenant.id, name: 'Vendas' }).returning()

const people = [
  { email: 'leo@acme.com', name: 'Léo Líder', role: 'TEAM_LEADER' },
  { email: 'bruno@acme.com', name: 'Bruno Silva', role: 'MEMBER' },
  { email: 'carla@acme.com', name: 'Carla Souza', role: 'MEMBER' },
] as const
const seeder = { userId: 'seed-demo', tenantId: tenant.id, name: 'seed-demo', impersonatedBy: null }
const ids: Record<string, string> = {}
for (const p of people) {
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, p.email))
  if (u) {
    ids[p.email] = u.id
    continue
  }
  const created = await auth.api.createUser({
    body: { ...p, password: 'demo-1234', data: { tenantId: tenant.id, teamId: team!.id } },
  })
  ids[p.email] = created.user.id
  await db.transaction((tx) => addMember(tx, seeder, { teamId: team!.id, userId: created.user.id, role: teamRoleOf(p.role) }))
  console.log('usuário:', p.email, '/ demo-1234')
}

const demo = [
  { title: 'Responder leads do dia', basePoints: 30, estimatedMinutes: 25, assignedTo: 'bruno@acme.com' },
  { title: 'Atualizar pipeline no CRM', basePoints: 20, estimatedMinutes: 15, assignedTo: 'bruno@acme.com' },
  { title: 'Preparar proposta cliente X', basePoints: 50, estimatedMinutes: 45, assignedTo: 'carla@acme.com' },
  { title: 'Follow-up de propostas abertas', basePoints: 25, estimatedMinutes: 20, assignedTo: null },
  { title: 'Cadastrar novos contatos', basePoints: 15, estimatedMinutes: 10, assignedTo: null },
]
const existing = await db.select({ n: tasks.id }).from(tasks).where(eq(tasks.teamId, team!.id))
if (existing.length === 0) {
  await db.insert(tasks).values(
    demo.map((d) => ({
      tenantId: tenant.id,
      teamId: team!.id,
      assignedToId: d.assignedTo ? ids[d.assignedTo]! : null,
      createdById: ids['leo@acme.com']!,
      title: d.title,
      basePoints: d.basePoints,
      estimatedSeconds: d.estimatedMinutes * 60,
    })),
  )
  console.log('tarefas criadas:', demo.length)
}
console.log('seed-demo ok')
process.exit(0)
