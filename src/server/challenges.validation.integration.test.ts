import { and, asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { auditEvents, notifications, tasks } from '#/db/schema'
import { ForbiddenError } from './roles'
import type { AuthCtx } from './roles'
import { attentionCount, teamFeed } from './stats'
import { attemptChallengeFor, cancelTaskFor, finishTaskFor, taskDetailFor, validatePointsFor } from './tasks.core'
import { addChallenge, addTeam, addUser, makeTenant } from './test-fixtures'

type Fixture = Awaited<ReturnType<typeof makeTenant>>

let f: Fixture
let teamB: Fixture['team']
let teamC: Fixture['team']
let leaderA: AuthCtx
let leaderB: AuthCtx
let leaderC: AuthCtx
let memberA: AuthCtx
let admin: AuthCtx
let otherAdmin: AuthCtx

const FLASH_MINUTES = 3
const minutes = (base: Date, m: number) => new Date(base.getTime() + m * 60_000)

/** Tentativa concluída rápido demais: fica retida para validação. */
async function flashAttempt(me: AuthCtx, challengeId: string, teamId?: string) {
  const t0 = new Date()
  const attempt = await attemptChallengeFor(me, challengeId, teamId, t0)
  await finishTaskFor(me, attempt.id, minutes(t0, FLASH_MINUTES))
  return attempt.id
}

const reload = async (taskId: string) => (await db.select().from(tasks).where(eq(tasks.id, taskId)))[0]!
const memberOfB = () => addUser(f, { role: 'MEMBER', team: teamB })

beforeAll(async () => {
  f = await makeTenant(0)
  ;[teamB, teamC] = [await addTeam(f, 'B'), await addTeam(f, 'C')]
  leaderA = f.leader
  leaderB = await addUser(f, { role: 'MEMBER', team: teamB, teamRole: 'LEADER' })
  leaderC = await addUser(f, { role: 'MEMBER', team: teamC, teamRole: 'LEADER' })
  memberA = await addUser(f, { role: 'MEMBER', team: f.team })
  admin = await addUser(f, { role: 'TENANT_ADMIN', team: f.team })
  otherAdmin = await addUser(f, { role: 'TENANT_ADMIN', team: null })
})
afterAll(async () => {
  await f.cleanup()
  await db.$client.end()
})

describe('quem valida a tentativa de desafio', () => {
  it('o líder da equipe dona valida a tentativa de quem é de outra equipe, e o resultado e a auditoria são os de sempre', async () => {
    const c = await addChallenge(f, { sharedWith: [teamB] })
    const attemptId = await flashAttempt(await memberOfB(), c.id)

    await validatePointsFor(leaderA, attemptId, true, 'conferido')

    expect(await reload(attemptId)).toMatchObject({ needsValidation: false, rejectedAt: null })
    const events = await db.select().from(auditEvents).where(eq(auditEvents.entityId, attemptId)).orderBy(asc(auditEvents.createdAt))
    expect(events.find((e) => e.action === 'task.points_validated')).toMatchObject({ actorId: leaderA.userId, meta: { reason: 'conferido' } })
  })

  it('rejeitar zera os pontos e avisa a pessoa', async () => {
    const c = await addChallenge(f, { sharedWith: [teamB] })
    const attempter = await memberOfB()
    const attemptId = await flashAttempt(attempter, c.id)

    await validatePointsFor(leaderA, attemptId, false)

    expect(await reload(attemptId)).toMatchObject({ awardedPoints: 0 })
    expect((await reload(attemptId)).rejectedAt).not.toBeNull()
    const inbox = await db.select().from(notifications).where(and(eq(notifications.userId, attempter.userId), eq(notifications.entityId, attemptId)))
    expect(inbox.map((n) => n.type)).toEqual(['points.rejected'])
  })

  it('o líder da equipe de quem tentou não valida a tentativa do desafio de outra equipe', async () => {
    const c = await addChallenge(f, { sharedWith: [teamB] })
    const attemptId = await flashAttempt(await memberOfB(), c.id)

    await expect(validatePointsFor(leaderB, attemptId, true)).rejects.toThrow(ForbiddenError)
    expect((await reload(attemptId)).needsValidation).toBe(true)
  })

  it('quem não tem relação com a tentativa nem sabe que ela existe', async () => {
    const c = await addChallenge(f, { sharedWith: [teamB] })
    const attemptId = await flashAttempt(await memberOfB(), c.id)

    await expect(validatePointsFor(leaderC, attemptId, true)).rejects.toThrow('Tarefa não encontrada')
  })

  it('o admin valida, com ou sem equipe', async () => {
    const c = await addChallenge(f, { sharedWith: [teamB] })
    const [first, second] = [await flashAttempt(await memberOfB(), c.id), await flashAttempt(await memberOfB(), c.id)]

    await validatePointsFor(admin, first, true)
    await validatePointsFor(otherAdmin, second, false)

    expect((await reload(first)).needsValidation).toBe(false)
    expect((await reload(second)).rejectedAt).not.toBeNull()
  })

  it('ninguém valida a própria tentativa: nem o líder da dona, nem o admin', async () => {
    const c = await addChallenge(f)
    const [leadersOwn, adminsOwn] = [await flashAttempt(leaderA, c.id), await flashAttempt(admin, c.id)]

    await expect(validatePointsFor(leaderA, leadersOwn, true)).rejects.toThrow(ForbiddenError)
    await expect(validatePointsFor(admin, adminsOwn, true)).rejects.toThrow(ForbiddenError)

    await validatePointsFor(admin, leadersOwn, true)
    await validatePointsFor(leaderA, adminsOwn, true)
  })

  it('o ajuste do tenant que tira challenge.validate do líder vale; o admin não depende dele', async () => {
    const c = await addChallenge(f)
    const attemptId = await flashAttempt(memberA, c.id)
    const revoked = { ...leaderA, capabilityOverrides: { LEADER: { 'challenge.validate': false } } }

    await expect(validatePointsFor(revoked, attemptId, true)).rejects.toThrow(ForbiddenError)
    await validatePointsFor(admin, attemptId, true)
  })

  it('o membro da dona não valida, nem com a capability concedida: só gestor da dona valida', async () => {
    const c = await addChallenge(f)
    const attemptId = await flashAttempt(await addUser(f, { role: 'MEMBER', team: f.team }), c.id)
    const granted = { ...memberA, capabilityOverrides: { MEMBER: { 'challenge.validate': true } } }

    await expect(validatePointsFor(granted, attemptId, true)).rejects.toThrow(ForbiddenError)
  })

  it('tarefa comum segue com a regra de sempre: o líder da própria equipe valida, o de outra não vê', async () => {
    const [task] = await db
      .insert(tasks)
      .values({ tenantId: f.tenant.id, teamId: f.team.id, createdById: leaderA.userId, assignedToId: memberA.userId, title: 'Comum', estimatedSeconds: 600, status: 'finished', needsValidation: true, awardedPoints: 10 })
      .returning()

    await expect(validatePointsFor(leaderB, task!.id, true)).rejects.toThrow('Tarefa não encontrada')
    await expect(validatePointsFor(memberA, task!.id, true)).rejects.toThrow(ForbiddenError)
    await validatePointsFor(leaderA, task!.id, true)
  })
})

describe('a fila de validação', () => {
  let queueTenant: Fixture
  let owner: AuthCtx
  let visitingLeader: AuthCtx
  let visiting: AuthCtx
  let tenantAdmin: AuthCtx
  let teamOwner: Fixture['team']
  let teamVisitor: Fixture['team']
  let attemptId: string
  let ownAttemptId: string

  beforeAll(async () => {
    queueTenant = await makeTenant(0)
    teamOwner = queueTenant.team
    teamVisitor = await addTeam(queueTenant, 'Visitante')
    owner = queueTenant.leader
    visitingLeader = await addUser(queueTenant, { role: 'MEMBER', team: teamVisitor, teamRole: 'LEADER' })
    visiting = await addUser(queueTenant, { role: 'MEMBER', team: teamVisitor })
    tenantAdmin = await addUser(queueTenant, { role: 'TENANT_ADMIN', team: null })
    const c = await addChallenge(queueTenant, { sharedWith: [teamVisitor] })
    attemptId = await flashAttempt(visiting, c.id)
    ownAttemptId = await flashAttempt(owner, c.id)
  })
  afterAll(() => queueTenant.cleanup())

  it('a tentativa pendente entra na fila do líder da dona e do admin, e só na deles', async () => {
    expect((await attentionCount(owner)).validation).toBe(1)
    expect((await attentionCount(tenantAdmin)).validation).toBe(2)
    expect((await attentionCount(visitingLeader)).validation).toBe(0)
    expect((await attentionCount(visiting)).validation).toBe(0)
  })

  it('a própria tentativa não entra na minha fila', async () => {
    const feed = await teamFeed(owner, [teamOwner.id])

    expect(feed.pendingValidation.map((p) => p.taskId)).toEqual([attemptId])
    expect(feed.pendingValidation[0]).toMatchObject({ challengeId: expect.any(String), teamName: 'Visitante' })
  })

  it('o feed do líder da equipe de quem tentou não traz a tentativa do desafio de outra equipe', async () => {
    expect((await teamFeed(visitingLeader, [teamVisitor.id])).pendingValidation).toEqual([])
  })

  it('o admin vê as duas no feed da equipe dona', async () => {
    const feed = await teamFeed(tenantAdmin, [teamOwner.id])

    expect(feed.pendingValidation.map((p) => p.taskId).sort()).toEqual([attemptId, ownAttemptId].sort())
  })

  it('a ordem da fila é a de conclusão, e validar tira da fila', async () => {
    await validatePointsFor(owner, attemptId, true)

    expect((await attentionCount(owner)).validation).toBe(0)
    expect((await attentionCount(tenantAdmin)).validation).toBe(1)
    await validatePointsFor(tenantAdmin, ownAttemptId, false)
    expect((await attentionCount(tenantAdmin)).validation).toBe(0)
  })

  it('a tarefa comum pendente continua na fila do líder da própria equipe', async () => {
    await db
      .insert(tasks)
      .values({ tenantId: queueTenant.tenant.id, teamId: teamVisitor.id, assignedToId: visiting.userId, title: 'Comum', estimatedSeconds: 600, status: 'finished', needsValidation: true, awardedPoints: 5 })

    expect((await attentionCount(visitingLeader)).validation).toBe(1)
    expect((await teamFeed(visitingLeader, [teamVisitor.id])).pendingValidation).toHaveLength(1)
    expect((await attentionCount(owner)).validation).toBe(0)
  })

  it('o líder sem a capability challenge.validate não enxerga a fila de tentativas', async () => {
    const c = await addChallenge(queueTenant)
    await flashAttempt(await addUser(queueTenant, { role: 'MEMBER', team: teamOwner }), c.id)
    const revoked = { ...owner, capabilityOverrides: { LEADER: { 'challenge.validate': false } } }

    expect((await attentionCount(owner)).validation).toBe(1)
    expect((await attentionCount(revoked)).validation).toBe(0)
  })
})

describe('cancelar a tentativa de desafio', () => {
  it('cancelam o líder da equipe de quem tentou e o da dona; o membro e o líder alheio, não', async () => {
    const c = await addChallenge(f, { sharedWith: [teamB] })
    const [byOwner, byAttempterLeader, byOutsider] = [await memberOfB(), await memberOfB(), await memberOfB()]
    const ids = [await attemptChallengeFor(byOwner, c.id), await attemptChallengeFor(byAttempterLeader, c.id), await attemptChallengeFor(byOutsider, c.id)]

    await expect(cancelTaskFor(leaderC, ids[2]!.id)).rejects.toThrow('Tarefa não encontrada')
    await expect(cancelTaskFor(byOutsider, ids[2]!.id)).rejects.toThrow(ForbiddenError)
    await cancelTaskFor(leaderA, ids[0]!.id)
    await cancelTaskFor(leaderB, ids[1]!.id)

    expect((await reload(ids[0]!.id)).status).toBe('cancelled')
    expect((await reload(ids[1]!.id)).status).toBe('cancelled')
    expect((await reload(ids[2]!.id)).status).toBe('in_progress')
  })

  it('o líder da dona abre o detalhe da tentativa de outra equipe e gerencia; o líder alheio não abre', async () => {
    const c = await addChallenge(f, { sharedWith: [teamB] })
    const attempt = await attemptChallengeFor(await memberOfB(), c.id)

    expect(await taskDetailFor(leaderA, attempt.id)).toMatchObject({ id: attempt.id, canManage: false, managesAttempt: true, isMine: false })
    await expect(taskDetailFor(leaderC, attempt.id)).rejects.toThrow('Tarefa não encontrada')
  })
})
