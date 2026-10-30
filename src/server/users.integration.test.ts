import { and, asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { auditEvents, invitations, sessions, taskTimeLogs, tasks, users } from '#/db/schema'
import { auth } from '#/lib/auth'
import { createInvitationCore } from './invitations.core'
import type { AuthCtx } from './roles'
import { ForbiddenError } from './roles'
import { addAdmin, makeTenant } from './test-fixtures'
import { deactivateUserCore, reactivateUserCore, updateUserCore } from './users.core'

let mine: Awaited<ReturnType<typeof makeTenant>>
let other: Awaited<ReturnType<typeof makeTenant>>
let admin: AuthCtx

beforeAll(async () => {
  mine = await makeTenant(1)
  other = await makeTenant(0)
  admin = await addAdmin(mine)
})
afterAll(async () => {
  await mine.cleanup()
  await other.cleanup()
  await db.$client.end()
})

describe('updateUserCore', () => {
  it('muda papel e equipe de outro usuário do tenant', async () => {
    const member = mine.members[0]!

    await updateUserCore(admin, { userId: member.userId, teamId: null, role: 'TEAM_LEADER' })

    const [u] = await db.select().from(users).where(eq(users.id, member.userId))
    expect(u).toMatchObject({ teamId: null, role: 'TEAM_LEADER' })
  })

  it('recusa equipe de outro tenant', async () => {
    const member = mine.members[0]!

    await expect(updateUserCore(admin, { userId: member.userId, teamId: other.team.id, role: 'MEMBER' })).rejects.toThrow('Equipe não encontrada')

    const [u] = await db.select().from(users).where(eq(users.id, member.userId))
    expect(u!.teamId).not.toBe(other.team.id)
  })

  it('admin não altera o próprio papel, para o tenant nunca ficar sem admin', async () => {
    await expect(updateUserCore(admin, { userId: admin.userId, teamId: admin.teamId, role: 'MEMBER' })).rejects.toThrow('próprio papel')

    const [u] = await db.select().from(users).where(eq(users.id, admin.userId))
    expect(u!.role).toBe('TENANT_ADMIN')
  })

  it('admin ainda pode mudar a própria equipe', async () => {
    await updateUserCore(admin, { userId: admin.userId, teamId: null, role: 'TENANT_ADMIN' })

    const [u] = await db.select().from(users).where(eq(users.id, admin.userId))
    expect(u!.teamId).toBeNull()
  })
})

describe('createInvitationCore', () => {
  it('recusa equipe de outro tenant e não grava convite', async () => {
    const email = `convidado-${mine.tenant.slug}@test.local`

    await expect(createInvitationCore(admin, { email, teamId: other.team.id, role: 'MEMBER' })).rejects.toThrow('Equipe não encontrada')

    const rows = await db.select().from(invitations).where(eq(invitations.email, email))
    expect(rows).toHaveLength(0)
  })

  it('aceita equipe do próprio tenant', async () => {
    const email = `ok-${mine.tenant.slug}@test.local`

    const inv = await createInvitationCore(admin, { email, teamId: mine.team.id, role: 'MEMBER' })

    expect(inv).toMatchObject({ tenantId: mine.tenant.id, teamId: mine.team.id })
  })
})

describe('desativar e reativar usuário', () => {
  const password = 'senha-forte-123'
  const deactivators = { 'user.deactivate': true }

  async function newUser(label: string, tenant = mine) {
    const email = `${label}-${tenant.tenant.slug}@test.local`
    const { user } = await auth.api.createUser({
      body: { name: label, email, password, role: 'MEMBER', data: { tenantId: tenant.tenant.id, teamId: tenant.team.id, mustChangePassword: false } },
    })
    return { id: user.id, email }
  }

  async function startWork(userId: string) {
    const [task] = await db
      .insert(tasks)
      .values({ tenantId: mine.tenant.id, teamId: mine.team.id, createdById: admin.userId, title: 'Em andamento', basePoints: 100, estimatedSeconds: 600, status: 'in_progress', assignedToId: userId })
      .returning()
    const [log] = await db.insert(taskTimeLogs).values({ taskId: task!.id, userId, startedAt: new Date(Date.now() - 60_000) }).returning()
    return { task: task!, log: log! }
  }

  const eventsOf = (entityId: string) =>
    db.select().from(auditEvents).where(and(eq(auditEvents.tenantId, mine.tenant.id), eq(auditEvents.entityId, entityId))).orderBy(asc(auditEvents.createdAt))

  const userRow = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0]!

  it('marca banido com o motivo, derruba as sessões e audita', async () => {
    const u = await newUser('desativado')
    await auth.api.signInEmail({ body: { email: u.email, password } })
    expect(await db.select().from(sessions).where(eq(sessions.userId, u.id))).toHaveLength(1)

    await deactivateUserCore(admin, u.id, 'saiu da empresa')

    expect(await userRow(u.id)).toMatchObject({ banned: true, banReason: 'saiu da empresa' })
    expect(await db.select().from(sessions).where(eq(sessions.userId, u.id))).toHaveLength(0)
    expect((await eventsOf(u.id)).at(-1)).toMatchObject({ action: 'user.deactivated', actorId: admin.userId, entityType: 'user', meta: { reason: 'saiu da empresa' } })
  })

  it('fecha o log de tempo aberto e devolve a tarefa ao pool', async () => {
    const u = await newUser('com-trabalho')
    const { task, log } = await startWork(u.id)

    await deactivateUserCore(admin, u.id)

    const [closed] = await db.select().from(taskTimeLogs).where(eq(taskTimeLogs.id, log.id))
    expect(closed!.stoppedAt).not.toBeNull()
    const [released] = await db.select().from(tasks).where(eq(tasks.id, task.id))
    expect(released).toMatchObject({ assignedToId: null, status: 'pending' })
  })

  it('usuário desativado não consegue entrar; reativado volta a entrar', async () => {
    const u = await newUser('sem-login')
    await deactivateUserCore(admin, u.id)

    await expect(auth.api.signInEmail({ body: { email: u.email, password } })).rejects.toThrow()

    await reactivateUserCore(admin, u.id)
    await expect(auth.api.signInEmail({ body: { email: u.email, password } })).resolves.toBeDefined()
    expect(await userRow(u.id)).toMatchObject({ banned: false, banReason: null })
    expect((await eventsOf(u.id)).map((e) => e.action)).toContain('user.reactivated')
  })

  it('repetir a desativação não duplica o evento', async () => {
    const u = await newUser('repetido')
    await deactivateUserCore(admin, u.id)

    await deactivateUserCore(admin, u.id)

    expect((await eventsOf(u.id)).filter((e) => e.action === 'user.deactivated')).toHaveLength(1)
  })

  it('recusa desativar a si mesmo', async () => {
    await expect(deactivateUserCore(admin, admin.userId)).rejects.toThrow('si mesmo')

    expect((await userRow(admin.userId)).banned).toBe(false)
  })

  it('recusa SUPER_ADMIN e usuário de outro tenant', async () => {
    const [root] = await db
      .insert(users)
      .values({ id: `root-${mine.tenant.slug}`, name: 'Root', email: `root-${mine.tenant.slug}@test.local`, role: 'SUPER_ADMIN', tenantId: mine.tenant.id })
      .returning()
    const foreign = await newUser('alheio', other)

    await expect(deactivateUserCore(admin, root!.id)).rejects.toThrow('não encontrado')
    await expect(deactivateUserCore(admin, foreign.id)).rejects.toThrow('não encontrado')

    expect((await userRow(foreign.id)).banned).toBe(false)
  })

  it('exige a capability user.deactivate', async () => {
    const u = await newUser('protegido')
    const leader = { ...mine.leader, capabilityOverrides: {} }

    await expect(deactivateUserCore(leader, u.id)).rejects.toThrow(ForbiddenError)
    await expect(reactivateUserCore(leader, u.id)).rejects.toThrow(ForbiddenError)

    expect((await userRow(u.id)).banned).toBe(false)
  })

  it('líder com a capability delegada só desativa membro da própria equipe', async () => {
    const leader = { ...mine.leader, capabilityOverrides: deactivators }
    const member = await newUser('do-lider')
    const foreign = await newUser('alheio-2', other)
    const foreignLeaderCtx = { ...other.leader, capabilityOverrides: deactivators }

    await deactivateUserCore(leader, member.id)
    await expect(deactivateUserCore(leader, admin.userId)).rejects.toThrow(ForbiddenError)
    await expect(deactivateUserCore(foreignLeaderCtx, member.id)).rejects.toThrow('não encontrado')
    await expect(deactivateUserCore(leader, foreign.id)).rejects.toThrow('não encontrado')

    expect((await userRow(member.id)).banned).toBe(true)
    expect((await userRow(admin.userId)).banned).toBe(false)
  })
})

describe('updateUserCore com user.update delegado a líder', () => {
  const leader = (): AuthCtx => ({ ...mine.leader, capabilityOverrides: { 'user.update': true } })

  it('não mexe em admin nem promove ninguém a admin', async () => {
    const member = await db.insert(users).values({ id: `m-${mine.tenant.slug}`, name: 'M', email: `m-${mine.tenant.slug}@test.local`, role: 'MEMBER', tenantId: mine.tenant.id, teamId: mine.team.id }).returning()

    await expect(updateUserCore(leader(), { userId: admin.userId, teamId: mine.team.id, role: 'MEMBER' })).rejects.toThrow(ForbiddenError)
    await expect(updateUserCore(leader(), { userId: member[0]!.id, teamId: mine.team.id, role: 'TENANT_ADMIN' })).rejects.toThrow(ForbiddenError)

    const [u] = await db.select().from(users).where(eq(users.id, member[0]!.id))
    expect(u!.role).toBe('MEMBER')
  })
})
