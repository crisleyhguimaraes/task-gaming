import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { challenges, tasks } from '#/db/schema'
import { listChallengesFor } from './challenges.core'
import { attemptChallengeFor, finishTaskFor } from './tasks.core'
import { addUser, makeTenant } from './test-fixtures'

let f: Awaited<ReturnType<typeof makeTenant>>
const min = (n: number) => n * 60
const at = (base: Date, minutes: number) => new Date(base.getTime() + min(minutes) * 1000)

beforeAll(async () => {
  f = await makeTenant(2)
})
afterAll(async () => {
  await f.cleanup()
  await db.$client.end()
})

describe('desafios', () => {
  it('tentativa cria task com challenge_id; recorde e ranking', async () => {
    const [a, b] = f.members
    const [c] = await db
      .insert(challenges)
      .values({ tenantId: f.tenant.id, teamId: f.team.id, createdById: a!.userId, title: 'Processar 20 pedidos', basePoints: 40, estimatedSeconds: min(30) })
      .returning()
    const t0 = new Date()
    const ta = await attemptChallengeFor(a!, c!.id, t0)
    expect(ta.challengeId).toBe(c!.id)
    expect(ta.status).toBe('in_progress')
    // tentar de novo com tentativa aberta → retoma a mesma
    const again = await attemptChallengeFor(a!, c!.id, at(t0, 1))
    expect(again.id).toBe(ta.id)

    const sa = await finishTaskFor(a!, ta.id, at(t0, 25))
    expect(sa.isNewRecord).toBe(true) // primeiro tempo válido
    expect(sa.movingSeconds).toBe(min(25)) // 1 min do primeiro bloco + 24 do segundo, sem gap

    const tb = await attemptChallengeFor(b!, c!.id, at(t0, 30))
    const sb = await finishTaskFor(b!, tb.id, at(t0, 50))
    expect(sb.movingSeconds).toBe(min(20))
    expect(sb.isNewRecord).toBe(true)

    const tb2 = await attemptChallengeFor(b!, c!.id, at(t0, 60))
    const sb2 = await finishTaskFor(b!, tb2.id, at(t0, 82))
    expect(sb2.isNewRecord).toBe(false) // 22 > 20

    const list = await listChallengesFor(a!)
    const item = list.find((x) => x.id === c!.id)!
    expect(item.record?.best).toBe(min(20))
    expect(item.record?.holderId).toBe(b!.userId)

    const rows = await db.select().from(tasks).where(eq(tasks.challengeId, c!.id))
    expect(rows).toHaveLength(3)
  })

  it('tentativa relâmpago não vira recorde (aguarda validação)', async () => {
    const a = f.members[0]!
    const [c] = await db
      .insert(challenges)
      .values({ tenantId: f.tenant.id, teamId: f.team.id, createdById: a.userId, title: 'Rápido', basePoints: 10, estimatedSeconds: min(30) })
      .returning()
    const t0 = new Date()
    const t = await attemptChallengeFor(a, c!.id, t0)
    const s = await finishTaskFor(a, t.id, at(t0, 2))
    expect(s.needsValidation).toBe(true)
    expect(s.isNewRecord).toBe(false)
    const list = await listChallengesFor(a)
    expect(list.find((x) => x.id === c!.id)!.record).toBeNull()
  })
})

describe('escopo da listagem', () => {
  it('usuário sem equipe não vê desafios, sem erro', async () => {
    const teamless = await addUser(f, { role: 'MEMBER', team: null })

    expect(await listChallengesFor(teamless)).toEqual([])
  })
})
