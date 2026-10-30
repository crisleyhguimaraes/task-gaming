import { and, asc, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { auditEvents, invitations, tasks, tenants, users } from '#/db/schema'
import { archiveChallengeFor, createChallengeFor } from './challenges.core'
import { addDependencyFor, removeDependencyFor } from './dependencies.core'
import { acceptInvitationCore, cancelInvitationFor, createInvitationCore, resendInvitationFor } from './invitations.core'
import type { AuthCtx } from './roles'
import { createTeamFor, deleteTeamFor } from './teams.core'
import { createTenantAdminFor, createTenantFor } from './tenants.core'
import { addAdmin, makeTenant } from './test-fixtures'
import { createUserFor, updateUserCore } from './users.core'

let f: Awaited<ReturnType<typeof makeTenant>>
let admin: AuthCtx
const createdTenants: Array<string> = []

const eventsOf = (tenantId: string, entityId: string) =>
  db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.tenantId, tenantId), eq(auditEvents.entityId, entityId)))
    .orderBy(asc(auditEvents.createdAt))

const newTask = async () => {
  const [t] = await db
    .insert(tasks)
    .values({ tenantId: f.tenant.id, teamId: f.team.id, createdById: f.leader.userId, title: 'T', basePoints: 10, estimatedSeconds: 600 })
    .returning()
  return t!
}

beforeAll(async () => {
  f = await makeTenant(2)
  admin = await addAdmin(f)
})
afterAll(async () => {
  if (createdTenants.length) await db.delete(tenants).where(inArray(tenants.id, createdTenants))
  await f.cleanup()
  await db.$client.end()
})

describe('usuários', () => {
  it('criar registra papel, equipe e email', async () => {
    const email = `novo-${f.tenant.slug}@test.local`

    const { id } = await createUserFor(admin, { name: 'Novo', email, password: 'senha-forte-123', teamId: f.team.id, role: 'MEMBER' })

    const [e] = await eventsOf(f.tenant.id, id)
    expect(e).toMatchObject({ action: 'user.created', entityType: 'user', actorId: admin.userId, meta: { email, role: 'MEMBER', teamId: f.team.id } })
  })

  it('alterar papel e equipe guarda antes e depois', async () => {
    const member = f.members[0]!

    await updateUserCore(admin, { userId: member.userId, teamId: null, role: 'TEAM_LEADER' })

    const [e] = await eventsOf(f.tenant.id, member.userId)
    expect(e).toMatchObject({ action: 'user.updated', changes: { role: { from: 'MEMBER', to: 'TEAM_LEADER' }, teamId: { from: f.team.id, to: null } } })
  })

  it('salvar sem mudar nada não grava evento', async () => {
    const member = f.members[1]!

    await updateUserCore(admin, { userId: member.userId, teamId: f.team.id, role: 'MEMBER' })

    expect(await eventsOf(f.tenant.id, member.userId)).toHaveLength(0)
  })
})

describe('convites', () => {
  it('criar, reenviar, cancelar e aceitar deixam rastro, e o aceite é do novo usuário', async () => {
    const email = `convite-${f.tenant.slug}@test.local`
    const inv = await createInvitationCore(admin, { email, teamId: f.team.id, role: 'MEMBER' })
    await resendInvitationFor(admin, inv.id)
    await acceptInvitationCore((await db.select().from(invitations).where(eq(invitations.id, inv.id)))[0]!.token, 'Convidada', 'senha-forte-123')

    const actions = (await eventsOf(f.tenant.id, inv.id)).map((e) => e.action)
    expect(actions).toEqual(['invitation.created', 'invitation.resent', 'invitation.accepted'])
    const accepted = (await eventsOf(f.tenant.id, inv.id)).at(-1)!
    const [created] = await db.select().from(users).where(eq(users.email, email))
    expect(accepted.actorId).toBe(created!.id)
  })

  it('cancelar registra o evento e remove o convite', async () => {
    const inv = await createInvitationCore(admin, { email: `cancela-${f.tenant.slug}@test.local`, teamId: f.team.id, role: 'MEMBER' })

    await cancelInvitationFor(admin, inv.id)

    expect((await eventsOf(f.tenant.id, inv.id)).map((e) => e.action)).toEqual(['invitation.created', 'invitation.cancelled'])
    expect(await db.select().from(invitations).where(eq(invitations.id, inv.id))).toHaveLength(0)
  })
})

describe('equipes', () => {
  it('criar e excluir deixam rastro com o nome', async () => {
    const team = await createTeamFor(admin, 'Temporária')

    await deleteTeamFor(admin, team.id)

    expect((await eventsOf(f.tenant.id, team.id)).map((e) => [e.action, e.meta])).toEqual([
      ['team.created', { name: 'Temporária' }],
      ['team.deleted', { name: 'Temporária' }],
    ])
  })

  it('equipe com tarefas não é excluída e não gera evento', async () => {
    await newTask()

    await expect(deleteTeamFor(admin, f.team.id)).rejects.toThrow('Equipe tem tarefas')

    expect((await eventsOf(f.tenant.id, f.team.id)).filter((e) => e.action === 'team.deleted')).toHaveLength(0)
  })
})

describe('tenants', () => {
  it('criar tenant e seu admin ficam registrados no tenant novo', async () => {
    const superAdmin: AuthCtx = { ...admin, role: 'SUPER_ADMIN' }
    const slug = `novo-${f.tenant.slug}`

    const tenant = await createTenantFor(superAdmin, { name: 'Novo Tenant', slug, timezone: 'America/Sao_Paulo' })
    createdTenants.push(tenant.id)
    await createTenantAdminFor(superAdmin, { tenantId: tenant.id, name: 'Dono', email: `dono-${slug}@test.local`, password: 'senha-forte-123' })

    const [created] = await eventsOf(tenant.id, tenant.id)
    expect(created).toMatchObject({ action: 'tenant.created', actorId: admin.userId })
    const [adminUser] = await db.select().from(users).where(eq(users.email, `dono-${slug}@test.local`))
    expect((await eventsOf(tenant.id, adminUser!.id))[0]).toMatchObject({ action: 'tenant.admin_created' })
  })
})

describe('desafios', () => {
  it('criar e arquivar deixam rastro', async () => {
    const c = await createChallengeFor(f.leader, { title: 'Desafio', basePoints: 10, estimatedMinutes: 5, teamId: f.team.id })

    await archiveChallengeFor(f.leader, c.id)

    expect((await eventsOf(f.tenant.id, c.id)).map((e) => e.action)).toEqual(['challenge.created', 'challenge.archived'])
  })
})

describe('dependências', () => {
  it('adicionar e remover registram as duas pontas', async () => {
    const a = await newTask()
    const b = await newTask()

    await addDependencyFor(f.leader, { taskId: a.id, dependsOnTaskId: b.id })
    await removeDependencyFor(f.leader, { taskId: a.id, dependsOnTaskId: b.id })

    const events = await eventsOf(f.tenant.id, a.id)
    expect(events.map((e) => e.action)).toEqual(['dependency.added', 'dependency.removed'])
    expect(events[0]!.meta).toEqual({ dependsOnTaskId: b.id })
  })
})
