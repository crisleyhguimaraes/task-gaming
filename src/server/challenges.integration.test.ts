import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { auditEvents, challenges, tasks } from '#/db/schema'
import { MAX_SCORED_ATTEMPTS_PER_DAY } from '#/lib/challenge'
import { archiveChallengeFor, challengeRanking, createChallengeFor, listChallengesFor } from './challenges.core'
import { ForbiddenError } from './roles'
import type { AuthCtx } from './roles'
import { attemptChallengeFor, cancelTaskFor, finishTaskFor, finishTaskManuallyFor, pauseTaskFor, startTaskFor, updateTaskFor, validatePointsFor } from './tasks.core'
import { addChallenge, addTeam, addUser, joinTeam, makeTenant } from './test-fixtures'

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
    const ta = await attemptChallengeFor(a!, c!.id, undefined, t0)
    expect(ta.challengeId).toBe(c!.id)
    expect(ta.status).toBe('in_progress')
    // tentar de novo com tentativa aberta → retoma a mesma
    const again = await attemptChallengeFor(a!, c!.id, undefined, at(t0, 1))
    expect(again.id).toBe(ta.id)

    const sa = await finishTaskFor(a!, ta.id, at(t0, 25))
    expect(sa.isNewRecord).toBe(true) // primeiro tempo válido
    expect(sa.movingSeconds).toBe(min(25)) // 1 min do primeiro bloco + 24 do segundo, sem gap

    const tb = await attemptChallengeFor(b!, c!.id, undefined, at(t0, 30))
    const sb = await finishTaskFor(b!, tb.id, at(t0, 50))
    expect(sb.movingSeconds).toBe(min(20))
    expect(sb.isNewRecord).toBe(true)

    const tb2 = await attemptChallengeFor(b!, c!.id, undefined, at(t0, 60))
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
    const t = await attemptChallengeFor(a, c!.id, undefined, t0)
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

const newMember = () => addUser(f, { role: 'MEMBER', team: f.team })

async function newChallenge(overrides: Partial<typeof challenges.$inferInsert> = {}) {
  const [c] = await db
    .insert(challenges)
    .values({ tenantId: f.tenant.id, teamId: f.team.id, createdById: f.leader.userId, title: 'Desafio', basePoints: 40, estimatedSeconds: min(30), ...overrides })
    .returning()
  return c!
}

/** Tenta e conclui em `minutes`; devolve o resumo da conclusão. */
async function attemptAndFinish(me: AuthCtx, challengeId: string, start: Date, minutes: number) {
  const attempt = await attemptChallengeFor(me, challengeId, undefined, start)
  return finishTaskFor(me, attempt.id, at(start, minutes))
}

const FLASH_MINUTES = 3

describe('tentativa rejeitada', () => {
  it('não é recorde, não lidera o ranking e não impede o próximo recorde', async () => {
    const [slow, fast] = [await newMember(), await newMember()]
    const c = await newChallenge()
    const t0 = new Date()
    await attemptAndFinish(slow, c.id, t0, 10)
    const flash = await attemptChallengeFor(fast, c.id, undefined, at(t0, 20))
    await finishTaskFor(fast, flash.id, at(t0, 20 + FLASH_MINUTES))

    await validatePointsFor(f.leader, flash.id, false)

    const [rejected] = await db.select().from(tasks).where(eq(tasks.id, flash.id))
    expect(rejected!.rejectedAt).not.toBeNull()
    const record = (await listChallengesFor(f.leader)).find((x) => x.id === c.id)!.record
    expect(record).toMatchObject({ best: min(10), holderId: slow.userId })
    expect((await challengeRanking(c.id)).map((r) => r.userId)).toEqual([slow.userId])
    const next = await attemptAndFinish(fast, c.id, at(t0, 60), 8)
    expect(next.isNewRecord).toBe(true)
  })

  it('aprovada continua valendo', async () => {
    const me = await newMember()
    const c = await newChallenge()
    const t0 = new Date()
    const flash = await attemptChallengeFor(me, c.id, undefined, t0)
    await finishTaskFor(me, flash.id, at(t0, FLASH_MINUTES))

    await validatePointsFor(f.leader, flash.id, true)

    expect((await listChallengesFor(f.leader)).find((x) => x.id === c.id)!.record).toMatchObject({ best: min(FLASH_MINUTES), holderId: me.userId })
  })
})

describe('desempate do recorde e do ranking', () => {
  it('empate de tempo fica com quem concluiu primeiro', async () => {
    const [late, early] = [await newMember(), await newMember()]
    const c = await newChallenge()
    const t0 = new Date()
    await attemptAndFinish(late, c.id, at(t0, 60), 12)
    await attemptAndFinish(early, c.id, t0, 12)

    const record = (await listChallengesFor(f.leader)).find((x) => x.id === c.id)!.record
    expect(record).toMatchObject({ best: min(12), holderId: early.userId })
    expect((await challengeRanking(c.id)).map((r) => r.userId)).toEqual([early.userId, late.userId])
  })

  it('no mesmo instante, vence o menor id', async () => {
    const [first, second] = [await newMember(), await newMember()]
    const c = await newChallenge()
    const [lowId, highId] = [randomUUID(), randomUUID()].sort() as [string, string]
    const finishedAt = new Date()
    const finished = (id: string, assignedToId: string) =>
      db.insert(tasks).values({
        id,
        tenantId: f.tenant.id,
        teamId: f.team.id,
        challengeId: c.id,
        assignedToId,
        title: c.title,
        basePoints: c.basePoints,
        estimatedSeconds: c.estimatedSeconds,
        status: 'finished',
        movingSeconds: min(12),
        finishedAt,
      })
    await finished(highId, first.userId)
    await finished(lowId, second.userId)

    const record = (await listChallengesFor(f.leader)).find((x) => x.id === c.id)!.record
    expect(record?.holderId).toBe(second.userId)
    expect((await challengeRanking(c.id)).map((r) => r.userId)).toEqual([second.userId, first.userId])
  })
})

describe('tentativa de desafio é do executor', () => {
  async function openAttempt() {
    const me = await newMember()
    const c = await newChallenge()
    const attempt = await attemptChallengeFor(me, c.id, undefined, new Date())
    return { me, c, attempt }
  }

  it('o líder não pausa nem conclui a tentativa de outra pessoa, mas o executor sim', async () => {
    const { me, attempt } = await openAttempt()

    await expect(pauseTaskFor(f.leader, attempt.id)).rejects.toThrow(ForbiddenError)
    await expect(finishTaskFor(f.leader, attempt.id)).rejects.toThrow(ForbiddenError)

    expect((await pauseTaskFor(me, attempt.id)).status).toBe('paused')
    expect((await finishTaskFor(me, attempt.id)).taskId).toBe(attempt.id)
  })

  it('não se conclui manualmente nem se edita, nem pelo líder', async () => {
    const { me, attempt } = await openAttempt()
    await pauseTaskFor(me, attempt.id)
    const edit = { taskId: attempt.id, title: 'Outro', basePoints: 9999, estimatedMinutes: 1, assignedToId: me.userId, priority: 'medium' as const, dueDate: null, scheduledStart: null, scheduledEnd: null }

    await expect(finishTaskManuallyFor(me, attempt.id)).rejects.toThrow('desafio')
    await expect(finishTaskManuallyFor(f.leader, attempt.id)).rejects.toThrow('desafio')
    await expect(updateTaskFor(f.leader, edit)).rejects.toThrow('desafio')

    const [row] = await db.select().from(tasks).where(eq(tasks.id, attempt.id))
    expect(row).toMatchObject({ status: 'paused', title: attempt.title, basePoints: attempt.basePoints })
  })

  it('o líder cancela, e a pessoa pode tentar de novo', async () => {
    const { me, c, attempt } = await openAttempt()

    await cancelTaskFor(f.leader, attempt.id)

    const again = await attemptChallengeFor(me, c.id, undefined, new Date())
    expect(again.id).not.toBe(attempt.id)
  })
})

describe('concorrência', () => {
  const CLICKS = 4

  // Sem conexões ociosas no pool, a segunda chamada espera uma conexão nova e a corrida não acontece.
  const warmPool = () => Promise.all(Array.from({ length: CLICKS }, () => db.execute(sql`select 1`)))

  it('vários cliques em tentar geram uma única tentativa aberta', async () => {
    const me = await newMember()
    const c = await newChallenge()
    await warmPool()

    const results = await Promise.all(Array.from({ length: CLICKS }, () => attemptChallengeFor(me, c.id)))

    expect(new Set(results.map((t) => t.id)).size).toBe(1)
    expect(await db.select().from(tasks).where(eq(tasks.challengeId, c.id))).toHaveLength(1)
  })

  it('duas conclusões simultâneas da mesma tentativa valem uma só vez', async () => {
    const me = await newMember()
    const c = await newChallenge()
    const t0 = new Date()
    const attempt = await attemptChallengeFor(me, c.id, undefined, t0)
    await warmPool()

    const results = await Promise.allSettled([finishTaskFor(me, attempt.id, at(t0, 20)), finishTaskFor(me, attempt.id, at(t0, 20))])

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const failure = results.find((r) => r.status === 'rejected')
    expect(failure?.reason).toMatchObject({ message: 'Tarefa não está em execução' })
  })
})

describe('tentativas pontuadas por dia', () => {
  const SAO_PAULO_MIDNIGHT = new Date('2026-03-10T03:00:00Z')
  const minutesBeforeMidnight = (m: number) => at(SAO_PAULO_MIDNIGHT, -m)

  it('só as primeiras do dia rendem pontos; as demais valem o tempo e o recorde', async () => {
    const me = await newMember()
    const c = await newChallenge({ scoredAttemptsPerDay: 2 })
    const t0 = new Date()

    const first = await attemptAndFinish(me, c.id, t0, 25)
    const second = await attemptAndFinish(me, c.id, at(t0, 30), 24)
    const third = await attemptAndFinish(me, c.id, at(t0, 60), 15)

    expect([first, second, third].map((s) => [s.scored, s.finalPoints])).toEqual([[true, 40], [true, 40], [false, 0]])
    expect(third.isNewRecord).toBe(true)
    const [row] = await db.select().from(tasks).where(eq(tasks.id, third.taskId))
    expect(row).toMatchObject({ awardedPoints: 0, movingSeconds: min(15), rejectedAt: null })
  })

  it('o limite recomeça no dia local do tenant, não no dia UTC', async () => {
    const me = await newMember()
    const c = await newChallenge()

    const beforeMidnight = await attemptAndFinish(me, c.id, minutesBeforeMidnight(60), 20)
    const sameLocalDay = await attemptAndFinish(me, c.id, minutesBeforeMidnight(30), 10)
    const afterMidnight = await attemptAndFinish(me, c.id, minutesBeforeMidnight(-5), 20)

    expect([beforeMidnight, sameLocalDay, afterMidnight].map((s) => s.scored)).toEqual([true, false, true])
  })

  it('tentativa retida para validação gasta o limite: o líder não aprova várias com pontos', async () => {
    const me = await newMember()
    const c = await newChallenge()
    const t0 = new Date()

    const first = await attemptAndFinish(me, c.id, t0, FLASH_MINUTES)
    const second = await attemptAndFinish(me, c.id, at(t0, 10), FLASH_MINUTES)

    expect([first.needsValidation, second.needsValidation]).toEqual([true, true])
    expect([first.scored, second.scored]).toEqual([true, false])
  })

  it('rejeitar a tentativa retida devolve a vaga; tentativa sem pontos não gasta vaga', async () => {
    const me = await newMember()
    const c = await newChallenge()
    const t0 = new Date()
    const flash = await attemptChallengeFor(me, c.id, undefined, t0)
    await finishTaskFor(me, flash.id, at(t0, FLASH_MINUTES))

    const blocked = await attemptAndFinish(me, c.id, at(t0, 10), 20)
    await validatePointsFor(f.leader, flash.id, false)
    const afterRejection = await attemptAndFinish(me, c.id, at(t0, 60), 20)
    const afterScored = await attemptAndFinish(me, c.id, at(t0, 90), 20)

    expect([blocked.scored, afterRejection.scored, afterScored.scored]).toEqual([false, true, false])
  })

  it('cada pessoa e cada desafio têm o seu limite', async () => {
    const [a, b] = [await newMember(), await newMember()]
    const [c1, c2] = [await newChallenge(), await newChallenge()]
    const t0 = new Date()

    await attemptAndFinish(a, c1.id, t0, 20)

    expect((await attemptAndFinish(b, c1.id, at(t0, 30), 20)).scored).toBe(true)
    expect((await attemptAndFinish(a, c2.id, at(t0, 60), 20)).scored).toBe(true)
  })

  it('tarefa comum sempre pontua', async () => {
    const me = await newMember()
    const [t] = await db
      .insert(tasks)
      .values({ tenantId: f.tenant.id, teamId: f.team.id, assignedToId: me.userId, title: 'Comum', basePoints: 40, estimatedSeconds: min(30) })
      .returning()
    const t0 = new Date()
    await startTaskFor(me, t!.id, t0)

    expect((await finishTaskFor(me, t!.id, at(t0, 25))).scored).toBe(true)
  })
})

describe('criar desafio', () => {
  const data = { title: 'Novo', basePoints: 100, estimatedMinutes: 10, scoredAttemptsPerDay: 1 }

  it('aceita até 1000 pontos base e recusa mais', async () => {
    await expect(createChallengeFor(f.leader, { ...data, basePoints: 1001, teamId: f.team.id })).rejects.toThrow('1000')

    const ok = await createChallengeFor(f.leader, { ...data, basePoints: 1000, teamId: f.team.id })
    expect(ok.basePoints).toBe(1000)
  })

  it('exige tentativas pontuadas por dia inteiras e positivas, e grava o valor na auditoria', async () => {
    for (const invalid of [0, -1, 1.5, MAX_SCORED_ATTEMPTS_PER_DAY + 1]) {
      await expect(createChallengeFor(f.leader, { ...data, scoredAttemptsPerDay: invalid, teamId: f.team.id })).rejects.toThrow('Tentativas pontuadas por dia')
    }

    const c = await createChallengeFor(f.leader, { ...data, scoredAttemptsPerDay: 3, teamId: f.team.id })

    expect(c.scoredAttemptsPerDay).toBe(3)
    const [event] = await db.select().from(auditEvents).where(eq(auditEvents.entityId, c.id))
    expect(event!.meta).toMatchObject({ scoredAttemptsPerDay: 3 })
  })
})

describe('arquivar desafio', () => {
  it('grava o instante do arquivamento recebido', async () => {
    const c = await addChallenge(f, { createdById: f.leader.userId })
    const now = new Date('2026-03-01T12:00:00Z')

    await archiveChallengeFor(f.leader, c.id, now)

    const [archived] = await db.select().from(challenges).where(eq(challenges.id, c.id))
    expect(archived!.archivedAt).toEqual(now)
  })
})

describe('desafio de equipe onde a pessoa é membro, entre várias', () => {
  const data = { title: 'Da B', basePoints: 50, estimatedMinutes: 10, scoredAttemptsPerDay: 1 }

  const memberOfAAndB = async () => {
    const teamB = await addTeam(f)
    const me = await joinTeam(f, (await addUser(f, { role: 'MEMBER', team: f.team })).userId, teamB)
    return { teamB, me }
  }

  it('cria, vê e tenta desafio da equipe que só integra', async () => {
    const { teamB, me } = await memberOfAAndB()

    const created = await createChallengeFor(me, { ...data, teamId: teamB.id })

    expect((await listChallengesFor(me)).map((c) => c.id)).toContain(created.id)
    const attempt = await attemptChallengeFor(me, created.id)
    expect(attempt).toMatchObject({ challengeId: created.id, teamId: teamB.id, assignedToId: me.userId, status: 'in_progress' })
  })

  it('não cria nem tenta desafio de equipe onde não é membro', async () => {
    const { me } = await memberOfAAndB()
    const outsideTeam = await addTeam(f, 'Fora')
    const [foreign] = await db
      .insert(challenges)
      .values({ tenantId: f.tenant.id, teamId: outsideTeam.id, createdById: f.leader.userId, title: 'Alheio', basePoints: 10, estimatedSeconds: min(5) })
      .returning()

    await expect(createChallengeFor(me, { ...data, teamId: outsideTeam.id })).rejects.toThrow('Você só cria desafios para a sua equipe')
    await expect(attemptChallengeFor(me, foreign!.id)).rejects.toThrow('Desafio não encontrado')
  })
})
