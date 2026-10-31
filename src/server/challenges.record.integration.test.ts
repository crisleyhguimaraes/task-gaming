import { and, asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { auditEvents, notifications } from '#/db/schema'
import { notificationMessage } from '#/lib/notifications'
import { listChallengesFor } from './challenges.core'
import { listMyNotificationsFor } from './notifications.core'
import type { AuthCtx } from './roles'
import { attemptChallengeFor, finishTaskFor, validatePointsFor } from './tasks.core'
import { addChallenge, addTeam, addUser, makeTenant } from './test-fixtures'

type Fixture = Awaited<ReturnType<typeof makeTenant>>

let f: Fixture
let teamB: Fixture['team']
let other: Fixture

const MS_PER_MINUTE = 60_000
const FLASH_MINUTES = 3
const minutes = (base: Date, m: number) => new Date(base.getTime() + m * MS_PER_MINUTE)

async function attempt(me: AuthCtx, challengeId: string, takes: number, start = new Date()) {
  const created = await attemptChallengeFor(me, challengeId, undefined, start)
  return { id: created.id, summary: await finishTaskFor(me, created.id, minutes(start, takes)) }
}

const recordNotices = async (me: AuthCtx) => (await listMyNotificationsFor(me)).filter((n) => n.type === 'challenge.record_broken')
const auditOf = (challengeId: string, action: 'challenge.record_broken' | 'challenge.attempt_finished') =>
  db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.entityId, challengeId), eq(auditEvents.action, action)))
    .orderBy(asc(auditEvents.createdAt), asc(auditEvents.id))

beforeAll(async () => {
  f = await makeTenant(0)
  other = await makeTenant(1)
  teamB = await addTeam(f, 'B')
})
afterAll(async () => {
  await f.cleanup()
  await other.cleanup()
  await db.$client.end()
})

describe('recorde batido', () => {
  it('avisa o detentor anterior em pt-BR e audita o recorde com tempo, equipe e quem perdeu', async () => {
    const [holder, challenger] = [await addUser(f, { role: 'MEMBER', team: f.team }), await addUser(f, { role: 'MEMBER', team: teamB })]
    const c = await addChallenge(f, { sharedWith: [teamB] })
    await attempt(holder, c.id, 20)

    const { id: winningAttempt, summary } = await attempt(challenger, c.id, 15, new Date(Date.now() + 1000))

    expect(summary.isNewRecord).toBe(true)
    const [notice] = await recordNotices(holder)
    expect(notice).toMatchObject({ entityType: 'challenge', entityId: c.id, payload: { by: challenger.name, taskTitle: c.title } })
    expect(notificationMessage(notice!.type, notice!.payload)).toBe(`${challenger.name} bateu o seu recorde em "${c.title}"`)
    const [broken] = await auditOf(c.id, 'challenge.record_broken')
    expect(broken).toMatchObject({
      actorId: challenger.userId,
      meta: { taskId: winningAttempt, byUserId: challenger.userId, teamId: teamB.id, seconds: 15 * 60, previousSeconds: 20 * 60, previousHolderId: holder.userId },
    })
    expect(await recordNotices(challenger)).toEqual([])
  })

  it('quem bate o próprio recorde não é avisado, mas o recorde é auditado', async () => {
    const me = await addUser(f, { role: 'MEMBER', team: f.team })
    const c = await addChallenge(f)
    await attempt(me, c.id, 20)

    await attempt(me, c.id, 15, new Date(Date.now() + 1000))

    expect(await recordNotices(me)).toEqual([])
    expect(await auditOf(c.id, 'challenge.record_broken')).toHaveLength(1)
  })

  it('o primeiro tempo é recorde mas não bate nada: sem aviso e sem evento de recorde batido; tempo igual ou pior também não', async () => {
    const [first, second] = [await addUser(f, { role: 'MEMBER', team: f.team }), await addUser(f, { role: 'MEMBER', team: f.team })]
    const c = await addChallenge(f)

    const opening = await attempt(first, c.id, 20)
    const tie = await attempt(second, c.id, 20, new Date(Date.now() + 1000))
    const slower = await attempt(second, c.id, 25, new Date(Date.now() + 2000))

    expect([opening.summary.isNewRecord, tie.summary.isNewRecord, slower.summary.isNewRecord]).toEqual([true, false, false])
    expect(await auditOf(c.id, 'challenge.record_broken')).toEqual([])
    expect(await recordNotices(first)).toEqual([])
  })

  it('toda tentativa concluída é auditada com tempo, equipe e se pontuou', async () => {
    const me = await addUser(f, { role: 'MEMBER', team: teamB })
    const c = await addChallenge(f, { sharedWith: [teamB] })
    const first = await attempt(me, c.id, 20)
    const second = await attempt(me, c.id, 22, new Date(Date.now() + 1000))

    const events = await auditOf(c.id, 'challenge.attempt_finished')

    expect(events.map((e) => e.meta)).toEqual([
      { taskId: first.id, teamId: teamB.id, seconds: 20 * 60, scored: true, needsValidation: false, isNewRecord: true },
      { taskId: second.id, teamId: teamB.id, seconds: 22 * 60, scored: false, needsValidation: false, isNewRecord: false },
    ])
  })
})

describe('recorde e tentativa retida para validação', () => {
  it('a rejeitada nunca vira recorde: ninguém é avisado e o detentor continua o mesmo', async () => {
    const [holder, fast] = [await addUser(f, { role: 'MEMBER', team: f.team }), await addUser(f, { role: 'MEMBER', team: f.team })]
    const c = await addChallenge(f)
    await attempt(holder, c.id, 20)
    const flash = await attempt(fast, c.id, FLASH_MINUTES, new Date(Date.now() + 1000))

    await validatePointsFor(f.leader, flash.id, false)

    expect(flash.summary.isNewRecord).toBe(false)
    expect(await recordNotices(holder)).toEqual([])
    expect((await listChallengesFor(f.leader)).find((x) => x.id === c.id)!.record).toMatchObject({ holderId: holder.userId, best: 20 * 60 })
  })

  it('ao aprovar a retida que supera o recorde, o detentor é avisado em nome de quem tentou', async () => {
    const [holder, fast] = [await addUser(f, { role: 'MEMBER', team: f.team }), await addUser(f, { role: 'MEMBER', team: f.team })]
    const c = await addChallenge(f)
    await attempt(holder, c.id, 20)
    const flash = await attempt(fast, c.id, FLASH_MINUTES, new Date(Date.now() + 1000))
    expect(await recordNotices(holder)).toEqual([])

    await validatePointsFor(f.leader, flash.id, true)

    const [notice] = await recordNotices(holder)
    expect(notice!.payload).toMatchObject({ by: fast.name })
    const [broken] = await auditOf(c.id, 'challenge.record_broken')
    expect(broken).toMatchObject({ actorId: f.leader.userId, meta: { byUserId: fast.userId, previousHolderId: holder.userId, seconds: FLASH_MINUTES * 60 } })
    expect((await listChallengesFor(f.leader)).find((x) => x.id === c.id)!.record).toMatchObject({ holderId: fast.userId })
  })

  it('o gestor que detém o recorde e aprova quem o superou também é avisado', async () => {
    const fast = await addUser(f, { role: 'MEMBER', team: f.team })
    const c = await addChallenge(f)
    await attempt(f.leader, c.id, 20)
    const flash = await attempt(fast, c.id, FLASH_MINUTES, new Date(Date.now() + 1000))

    await validatePointsFor(f.leader, flash.id, true)

    expect(await recordNotices(f.leader)).toHaveLength(1)
  })

  it('aprovar a retida que não supera o recorde não avisa ninguém', async () => {
    const [holder, slow] = [await addUser(f, { role: 'MEMBER', team: f.team }), await addUser(f, { role: 'MEMBER', team: f.team })]
    const c = await addChallenge(f, { estimatedSeconds: 10 * 60 })
    await attempt(holder, c.id, 1)
    const held = await attempt(slow, c.id, 1.5, new Date(Date.now() + 1000))
    expect(held.summary.needsValidation).toBe(true)

    await validatePointsFor(f.leader, held.id, true)

    expect(await auditOf(c.id, 'challenge.record_broken')).toEqual([])
    expect(await recordNotices(holder)).toEqual([])
  })
})

describe('isolamento entre tenants', () => {
  it('o aviso de recorde fica no tenant do desafio', async () => {
    const [holder, challenger] = [await addUser(f, { role: 'MEMBER', team: f.team }), await addUser(f, { role: 'MEMBER', team: f.team })]
    const c = await addChallenge(f)
    await attempt(holder, c.id, 20)
    await attempt(challenger, c.id, 15, new Date(Date.now() + 1000))

    const [row] = await db.select().from(notifications).where(and(eq(notifications.entityId, c.id), eq(notifications.type, 'challenge.record_broken')))
    expect(row).toMatchObject({ tenantId: f.tenant.id, userId: holder.userId })
    expect(await recordNotices(other.members[0]!)).toEqual([])
  })
})
