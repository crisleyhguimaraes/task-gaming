import { and, asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { auditEvents, challenges, invitations, sessions, taskTimeLogs, tasks, teamMembers, teams, users } from '#/db/schema'
import { auth } from '#/lib/auth'
import { createInvitationCore, listInvitationsFor } from './invitations.core'
import type { AuthCtx } from './roles'
import { ForbiddenError } from './roles'
import { addAdmin, addLoginUser, addTeam, addUser, joinTeam, makeTenant } from './test-fixtures'
import { createUserFor, deactivateUserCore, listUsersFor, reactivateUserCore, updateUserCore } from './users.core'

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
  const roleOf = async (userId: string) => (await db.select().from(users).where(eq(users.id, userId)))[0]!.role

  it('muda o papel de tenant de outro usuário', async () => {
    const member = mine.members[0]!

    await updateUserCore(admin, { userId: member.userId, role: 'TENANT_ADMIN' })
    expect(await roleOf(member.userId)).toBe('TENANT_ADMIN')

    await updateUserCore(admin, { userId: member.userId, role: 'MEMBER' })
    expect(await roleOf(member.userId)).toBe('MEMBER')
  })

  it('recusa usuário de outro tenant e SUPER_ADMIN', async () => {
    const foreign = other.leader
    const [root] = await db
      .insert(users)
      .values({ id: `root-up-${mine.tenant.slug}`, name: 'Root', email: `root-up-${mine.tenant.slug}@test.local`, role: 'SUPER_ADMIN', tenantId: mine.tenant.id })
      .returning()

    await expect(updateUserCore(admin, { userId: foreign.userId, role: 'TENANT_ADMIN' })).rejects.toThrow('não encontrado')
    await expect(updateUserCore(admin, { userId: root!.id, role: 'MEMBER' })).rejects.toThrow('não encontrado')

    expect(await roleOf(foreign.userId)).toBe('MEMBER')
  })

  it('admin não altera o próprio papel, para o tenant nunca ficar sem admin', async () => {
    await expect(updateUserCore(admin, { userId: admin.userId, role: 'MEMBER' })).rejects.toThrow('próprio papel')

    expect(await roleOf(admin.userId)).toBe('TENANT_ADMIN')
  })

  it('repetir o papel que a pessoa já tem não muda nada', async () => {
    await expect(updateUserCore(admin, { userId: admin.userId, role: 'TENANT_ADMIN' })).resolves.toBeUndefined()
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

    expect(inv).toMatchObject({ tenantId: mine.tenant.id, teamId: mine.team.id, role: 'MEMBER', teamRole: 'MEMBER' })
  })

  it('grava o papel de equipe do convite e o lista como pendente', async () => {
    const email = `lider-${mine.tenant.slug}@test.local`

    await createInvitationCore(admin, { email, teamId: mine.team.id, role: 'MEMBER', teamRole: 'LEADER' })

    const listed = (await listInvitationsFor(admin)).find((i) => i.email === email)
    expect(listed).toMatchObject({ role: 'MEMBER', teamRole: 'LEADER' })
  })
})

describe('desativar e reativar usuário', () => {
  const password = 'senha-forte-123'
  const deactivators = { LEADER: { 'user.deactivate': true } }

  const newUser = (label: string, tenant = mine) => addLoginUser(tenant, { label, password })

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

  it('cancela a tentativa de desafio aberta em vez de devolvê-la ao pool', async () => {
    const u = await newUser('com-desafio')
    const [challenge] = await db
      .insert(challenges)
      .values({ tenantId: mine.tenant.id, teamId: mine.team.id, createdById: admin.userId, title: 'Desafio', basePoints: 10, estimatedSeconds: 600 })
      .returning()
    const { task } = await startWork(u.id)
    await db.update(tasks).set({ challengeId: challenge!.id }).where(eq(tasks.id, task.id))

    await deactivateUserCore(admin, u.id)

    const [attempt] = await db.select().from(tasks).where(eq(tasks.id, task.id))
    expect(attempt).toMatchObject({ status: 'cancelled', assignedToId: u.id })
  })

  it('quem está em várias equipes só é desativado por líder de todas elas, ou por admin', async () => {
    const teamB = await addTeam(mine, 'B-multi')
    const member = await newUser('duas-equipes')
    await joinTeam(mine, member.id, teamB)
    const leaderOfA = { ...mine.leader, capabilityOverrides: deactivators }
    const both = await addUser(mine, { role: 'MEMBER', team: mine.team, teamRole: 'LEADER' })
    const leaderOfBoth = { ...(await joinTeam(mine, both.userId, teamB, 'LEADER')), capabilityOverrides: deactivators }

    await expect(deactivateUserCore(leaderOfA, member.id)).rejects.toThrow(ForbiddenError)
    await expect(reactivateUserCore(leaderOfA, member.id)).rejects.toThrow(ForbiddenError)
    expect((await userRow(member.id)).banned).toBe(false)

    await deactivateUserCore(leaderOfBoth, member.id)
    expect((await userRow(member.id)).banned).toBe(true)

    const other2 = await newUser('duas-equipes-admin')
    await joinTeam(mine, other2.id, teamB)
    await deactivateUserCore(admin, other2.id)
    expect((await userRow(other2.id)).banned).toBe(true)
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

describe('updateUserCore é só de admin', () => {
  const delegated: AuthCtx['capabilityOverrides'] = { LEADER: { 'user.update': true }, MEMBER: { 'user.update': true } }

  it('delegar user.update a líder ou a membro não vale: o override é ignorado', async () => {
    const member = await addUser(mine, { role: 'MEMBER', team: mine.team })

    await expect(updateUserCore({ ...mine.leader, capabilityOverrides: delegated }, { userId: member.userId, role: 'TENANT_ADMIN' })).rejects.toThrow(ForbiddenError)
    await expect(updateUserCore({ ...member, capabilityOverrides: delegated }, { userId: admin.userId, role: 'MEMBER' })).rejects.toThrow(ForbiddenError)

    expect((await userRowOf(member.userId)).role).toBe('MEMBER')
    expect((await userRowOf(admin.userId)).role).toBe('TENANT_ADMIN')
  })
})

describe('criar usuário e convidar com a capability delegada a quem não é líder', () => {
  const password = 'senha-forte-123'
  const delegated: AuthCtx['capabilityOverrides'] = { MEMBER: { 'user.create': true, 'invitation.manage': true } }
  const member = (): AuthCtx => ({ ...mine.members[0]!, capabilityOverrides: delegated })
  const uniqueEmail = (label: string) => `${label}-${Math.random().toString(36).slice(2, 8)}@test.local`
  let otherTeamId: string

  beforeAll(async () => {
    const [team] = await db.insert(teams).values({ tenantId: mine.tenant.id, name: 'Outra equipe' }).returning()
    otherTeamId = team!.id
  })

  it('membro não cria administrador nem usuário de outra equipe', async () => {
    const email = uniqueEmail('escalada')

    await expect(createUserFor(member(), { name: 'X', email, password, teamId: mine.team.id, role: 'TENANT_ADMIN' })).rejects.toThrow(ForbiddenError)
    await expect(createUserFor(member(), { name: 'X', email, password, teamId: otherTeamId, role: 'MEMBER' })).rejects.toThrow(ForbiddenError)

    expect(await db.select().from(users).where(eq(users.email, email))).toHaveLength(0)
  })

  it('membro cria membro da própria equipe', async () => {
    const user = await createUserFor(member(), { name: 'Colega', email: uniqueEmail('colega'), password, teamId: mine.team.id, role: 'MEMBER' })

    expect(await userRowOf(user.id)).toMatchObject({ role: 'MEMBER' })
    expect(await db.select({ teamId: teamMembers.teamId, role: teamMembers.role }).from(teamMembers).where(eq(teamMembers.userId, user.id))).toEqual([{ teamId: mine.team.id, role: 'MEMBER' }])
  })

  it('membro não cria nem convida líder, mesmo na própria equipe', async () => {
    const email = uniqueEmail('lider-delegado')

    await expect(createUserFor(member(), { name: 'X', email, password, teamId: mine.team.id, role: 'MEMBER', teamRole: 'LEADER' })).rejects.toThrow(ForbiddenError)
    await expect(createInvitationCore(member(), { email, teamId: mine.team.id, role: 'MEMBER', teamRole: 'LEADER' })).rejects.toThrow(ForbiddenError)

    expect(await db.select().from(users).where(eq(users.email, email))).toHaveLength(0)
    expect(await db.select().from(invitations).where(eq(invitations.email, email))).toHaveLength(0)
  })

  it('membro não convida administrador nem para outra equipe', async () => {
    const email = uniqueEmail('convite')

    await expect(createInvitationCore(member(), { email, teamId: mine.team.id, role: 'TENANT_ADMIN' })).rejects.toThrow(ForbiddenError)
    await expect(createInvitationCore(member(), { email, teamId: otherTeamId, role: 'MEMBER' })).rejects.toThrow(ForbiddenError)

    expect(await db.select().from(invitations).where(eq(invitations.email, email))).toHaveLength(0)
  })

  it('líder continua restrito do mesmo jeito', async () => {
    const leader: AuthCtx = { ...mine.leader, capabilityOverrides: {} }

    await expect(createUserFor(leader, { name: 'X', email: uniqueEmail('lider'), password, teamId: mine.team.id, role: 'MEMBER', teamRole: 'LEADER' })).rejects.toThrow(ForbiddenError)
  })
})

describe('líder sem equipe', () => {
  const password = 'senha-forte-123'
  const delegated: AuthCtx['capabilityOverrides'] = { MEMBER: { 'user.update': true, 'user.deactivate': true, 'user.create': true, 'invitation.manage': true } }
  const teamlessLeader = async (): Promise<AuthCtx> => ({ ...(await addUser(mine, { role: 'MEMBER', team: null, teamRole: 'LEADER' })), capabilityOverrides: delegated })
  const uniqueEmail = (label: string) => `${label}-${Math.random().toString(36).slice(2, 8)}@test.local`

  it('não muda nem desativa usuário que também está sem equipe', async () => {
    const leader = await teamlessLeader()
    const teamless = await addUser(mine, { role: 'MEMBER', team: null })

    await expect(updateUserCore(leader, { userId: teamless.userId, role: 'MEMBER' })).rejects.toThrow(ForbiddenError)
    await expect(deactivateUserCore(leader, teamless.userId)).rejects.toThrow(ForbiddenError)

    expect(await userRowOf(teamless.userId)).toMatchObject({ banned: false })
  })

  it('não cria usuário nem convida sem equipe', async () => {
    const leader = await teamlessLeader()
    const [userEmail, inviteEmail] = [uniqueEmail('sem-equipe'), uniqueEmail('convite-sem-equipe')]

    await expect(createUserFor(leader, { name: 'X', email: userEmail, password, teamId: null, role: 'MEMBER' })).rejects.toThrow(ForbiddenError)
    await expect(createInvitationCore(leader, { email: inviteEmail, teamId: null, role: 'MEMBER' })).rejects.toThrow(ForbiddenError)

    expect(await db.select().from(users).where(eq(users.email, userEmail))).toHaveLength(0)
    expect(await db.select().from(invitations).where(eq(invitations.email, inviteEmail))).toHaveLength(0)
  })
})

async function userRowOf(id: string) {
  return (await db.select().from(users).where(eq(users.id, id)))[0]!
}

describe('listUsersFor', () => {
  it('líder vê só a própria equipe, admin vê o tenant e quem não lê usuários é recusado', async () => {
    const f = await makeTenant(1)
    const teamB = await addTeam(f, 'B')
    const inB = await addUser(f, { role: 'MEMBER', team: teamB })
    const idsOf = async (me: AuthCtx) => (await listUsersFor(me)).users.map((u) => u.id)

    try {
      expect(await idsOf(f.leader)).toEqual(expect.arrayContaining([f.leader.userId, f.members[0]!.userId]))
      expect(await idsOf(f.leader)).not.toContain(inB.userId)
      expect(await idsOf(await addAdmin(f))).toContain(inB.userId)
      await expect(listUsersFor(f.members[0]!)).rejects.toThrow(ForbiddenError)
    } finally {
      await f.cleanup()
    }
  })

  it('devolve as equipes de cada pessoa com o papel em cada uma', async () => {
    const f = await makeTenant(1)
    const teamB = await addTeam(f, 'B')
    const both = await addUser(f, { role: 'MEMBER', team: f.team, teamRole: 'LEADER' })
    await joinTeam(f, both.userId, teamB, 'MEMBER')

    try {
      const { users: list } = await listUsersFor(await addAdmin(f))

      const row = list.find((u) => u.id === both.userId)!
      expect([...row.memberships].sort((a, b) => a.teamName.localeCompare(b.teamName))).toEqual([
        { teamId: teamB.id, teamName: 'B', role: 'MEMBER' },
        { teamId: f.team.id, teamName: 'Time', role: 'LEADER' },
      ])
      expect(list.find((u) => u.id === f.members[0]!.userId)!.memberships).toEqual([{ teamId: f.team.id, teamName: 'Time', role: 'MEMBER' }])
    } finally {
      await f.cleanup()
    }
  })

  it('usuário sem equipe com permissão de ler usuários vê lista vazia, sem erro', async () => {
    const teamless = { ...(await addUser(mine, { role: 'MEMBER', team: null })), capabilityOverrides: { MEMBER: { 'user.read': true } } }

    const result = await listUsersFor(teamless)

    expect(result.users).toEqual([])
    expect(result.teams.map((t) => t.id)).toContain(mine.team.id)
  })
})
