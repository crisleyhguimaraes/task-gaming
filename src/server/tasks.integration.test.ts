import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { taskDependencies, taskTimeLogs, tasks } from '#/db/schema'
import { cancelTaskFor, finishTaskFor, finishTaskManuallyFor, pauseTaskFor, returnToPoolFor, startTaskFor, validatePointsFor } from './tasks.core'
import { makeTenant } from './test-fixtures'

let f: Awaited<ReturnType<typeof makeTenant>>
const min = (n: number) => n * 60
const at = (base: Date, minutes: number) => new Date(base.getTime() + min(minutes) * 1000)

async function newTask(assignedToId: string | null, estimatedSeconds = min(10)) {
  const [t] = await db
    .insert(tasks)
    .values({ tenantId: f.tenant.id, teamId: f.team.id, assignedToId, createdById: f.leader.userId, title: 'T', basePoints: 100, estimatedSeconds })
    .returning()
  return t!
}

beforeAll(async () => {
  f = await makeTenant(2)
})
afterAll(async () => {
  await f.cleanup()
  await db.$client.end()
})

describe('tasks.core', () => {
  it('claim concorrente do pool: só um ganha', async () => {
    const t = await newTask(null)
    const [a, b] = f.members
    const results = await Promise.allSettled([startTaskFor(a!, t.id), startTaskFor(b!, t.id)])
    const ok = results.filter((r) => r.status === 'fulfilled')
    expect(ok).toHaveLength(1)
    const [row] = await db.select().from(tasks).where(eq(tasks.id, t.id))
    expect(row!.status).toBe('in_progress')
    expect([a!.userId, b!.userId]).toContain(row!.assignedToId)
  })

  it('iniciar outra tarefa pausa a anterior e fecha o log', async () => {
    const me = f.members[0]!
    const t1 = await newTask(me.userId)
    const t2 = await newTask(me.userId)
    const t0 = new Date()
    await startTaskFor(me, t1.id, t0)
    await startTaskFor(me, t2.id, at(t0, 3))
    const [r1] = await db.select().from(tasks).where(eq(tasks.id, t1.id))
    expect(r1!.status).toBe('paused')
    const logs = await db.select().from(taskTimeLogs).where(eq(taskTimeLogs.taskId, t1.id))
    expect(logs).toHaveLength(1)
    expect(logs[0]!.durationSeconds).toBe(min(3))
    await pauseTaskFor(me, t2.id, at(t0, 4))
  })

  it('finish soma blocos, aplica pontuação e grava campos imutáveis', async () => {
    const me = f.members[1]!
    const t = await newTask(me.userId, min(10))
    const t0 = new Date()
    await startTaskFor(me, t.id, t0)
    await pauseTaskFor(me, t.id, at(t0, 4))
    await startTaskFor(me, t.id, at(t0, 5))
    const s = await finishTaskFor(me, t.id, at(t0, 8))
    expect(s.movingSeconds).toBe(min(7)) // 4 + 3
    expect(s.elapsedSeconds).toBe(min(8)) // + gap de 1
    expect(s.paceBonus).toBe(15) // 7/10 < 0.8
    expect(s.finalPoints).toBe(115)
    expect(s.needsValidation).toBe(false)
    const [row] = await db.select().from(tasks).where(eq(tasks.id, t.id))
    expect(row!.status).toBe('finished')
    expect(row!.awardedPoints).toBe(115)
    await expect(finishTaskFor(me, t.id)).rejects.toThrow(/não está em execução/)
  })

  it('membro não inicia tarefa de outro; líder pode finalizar tarefa do time', async () => {
    const [a, b] = f.members
    const t = await newTask(a!.userId)
    await expect(startTaskFor(b!, t.id)).rejects.toThrow(/indisponível/)
    await startTaskFor(a!, t.id)
    const s = await finishTaskFor(f.leader, t.id)
    expect(s.taskId).toBe(t.id)
  })

  it('bloco esquecido aberto é travado no teto', async () => {
    const me = f.members[0]!
    const t = await newTask(me.userId, min(10)) // cap 30min
    const t0 = new Date()
    await startTaskFor(me, t.id, t0)
    const s = await finishTaskFor(me, t.id, at(t0, 600)) // 10h depois
    expect(s.movingSeconds).toBe(min(30))
    expect(s.finalPoints).toBe(50) // estouro máximo → piso
  })

  it('devolver ao pool limpa o dono e mantém logs; cancelar zera pontos; validação aprova/rejeita', async () => {
    const [a, b] = f.members
    const t = await newTask(a!.userId)
    const t0 = new Date()
    await startTaskFor(a!, t.id, t0)
    const back = await returnToPoolFor(a!, t.id, at(t0, 2))
    expect(back.status).toBe('pending')
    expect(back.assignedToId).toBeNull()
    expect(await db.select().from(taskTimeLogs).where(eq(taskTimeLogs.taskId, t.id))).toHaveLength(1)
    // agora b consegue puxar
    await startTaskFor(b!, t.id, at(t0, 3))
    await expect(cancelTaskFor(b!, t.id)).rejects.toThrow(/Sem permissão/)
    const cancelled = await cancelTaskFor(f.leader, t.id, at(t0, 4))
    expect(cancelled.status).toBe('cancelled')

    const fast = await newTask(a!.userId, min(30))
    await startTaskFor(a!, fast.id, t0)
    const s = await finishTaskFor(a!, fast.id, at(t0, 1))
    expect(s.needsValidation).toBe(true)
    await expect(validatePointsFor(a!, fast.id, true)).rejects.toThrow(/Sem permissão/)
    const rejected = await validatePointsFor(f.leader, fast.id, false)
    expect(rejected.awardedPoints).toBe(0)
    expect(rejected.needsValidation).toBe(false)
  })

  it('conclusão manual: pontos base, moving = estimado, sem bônus; não vale pra em andamento', async () => {
    const a = f.members[0]!
    const pool = await newTask(null, min(10))
    const s = await finishTaskManuallyFor(a, pool.id)
    expect(s.manual).toBe(true)
    expect(s.finalPoints).toBe(100)
    expect(s.movingSeconds).toBe(min(10))
    const [row] = await db.select().from(tasks).where(eq(tasks.id, pool.id))
    expect(row!.assignedToId).toBe(a.userId)
    expect(row!.manualFinish).toBe(true)
    const running = await newTask(a.userId)
    await startTaskFor(a, running.id)
    await expect(finishTaskManuallyFor(a, running.id)).rejects.toThrow(/pendentes ou pausadas/)
  })

  it('tarefa bloqueada por dependência não inicia; libera quando a dependência conclui', async () => {
    const a = f.members[0]!
    const dep = await newTask(a.userId)
    const t = await newTask(a.userId)
    await db.insert(taskDependencies).values({ tenantId: f.tenant.id, taskId: t.id, dependsOnTaskId: dep.id })
    await expect(startTaskFor(a, t.id)).rejects.toThrow(/Bloqueada/)
    await startTaskFor(a, dep.id)
    await finishTaskFor(a, dep.id, new Date(Date.now() + min(9) * 1000))
    const started = await startTaskFor(a, t.id)
    expect(started.status).toBe('in_progress')
  })
})
