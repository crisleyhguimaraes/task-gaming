import { and, asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { auditEvents } from '#/db/schema'
import type { AuthCtx } from './roles'
import { attemptChallengeFor, finishTaskFor } from './tasks.core'
import { addChallenge, addUser, makeTenant } from './test-fixtures'

type Fixture = Awaited<ReturnType<typeof makeTenant>>

let f: Fixture

const MS_PER_MINUTE = 60_000
const ROUNDS = 8
const minutes = (base: Date, m: number) => new Date(base.getTime() + m * MS_PER_MINUTE)

const brokenEvents = (challengeId: string) =>
  db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.entityId, challengeId), eq(auditEvents.action, 'challenge.record_broken')))
    .orderBy(asc(auditEvents.createdAt), asc(auditEvents.id))

async function finishedAttempt(me: AuthCtx, challengeId: string, takes: number, start: Date) {
  const created = await attemptChallengeFor(me, challengeId, undefined, start)
  return () => finishTaskFor(me, created.id, minutes(start, takes))
}

beforeAll(async () => {
  f = await makeTenant(0)
})
afterAll(async () => {
  await f.cleanup()
  await db.$client.end()
})

describe('recorde batido por duas pessoas ao mesmo tempo', () => {
  it('cada troca de mãos parte do detentor anterior de verdade: ninguém "bate" o mesmo recorde duas vezes', async () => {
    const chainBreaks: Array<string> = []
    for (let round = 0; round < ROUNDS; round++) {
      const [holder, slower, faster] = [
        await addUser(f, { role: 'MEMBER', team: f.team }),
        await addUser(f, { role: 'MEMBER', team: f.team }),
        await addUser(f, { role: 'MEMBER', team: f.team }),
      ]
      const challenge = await addChallenge(f)
      const start = new Date()
      await (await finishedAttempt(holder, challenge.id, 20, start))()
      const [finishSlower, finishFaster] = [await finishedAttempt(slower, challenge.id, 15, start), await finishedAttempt(faster, challenge.id, 14, start)]

      await Promise.all([finishSlower(), finishFaster()])

      const events = await brokenEvents(challenge.id)
      const previousHolders = events.map((e) => (e.meta as { previousHolderId: string }).previousHolderId)
      if (new Set(previousHolders).size !== previousHolders.length) chainBreaks.push(challenge.id)
    }

    expect(chainBreaks).toEqual([])
  })
})
