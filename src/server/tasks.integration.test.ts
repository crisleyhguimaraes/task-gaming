import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { taskDependencies, taskTimeLogs, tasks, teamMembers, users } from '#/db/schema'
import { boardMembersFor, cancelTaskFor, createTaskFor, finishTaskFor, finishTaskManuallyFor, pauseTaskFor, returnToPoolFor, startTaskFor, taskFormOptionsFor, taskListWhere, updateTaskFor, validatePointsFor } from './tasks.core'
import { removeMember } from './team-members.core'
import { addAdmin, addTeam, addUser, joinTeam, makeTenant } from './test-fixtures'

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

  it('iniciar tarefa bloqueada de outro tenant não revela o título do bloqueador', async () => {
    const foreign = await makeTenant(0)
    try {
      const [blocker, blocked] = await db
        .insert(tasks)
        .values(['Segredo do outro tenant', 'Bloqueada alheia'].map((title) => ({ tenantId: foreign.tenant.id, teamId: foreign.team.id, createdById: foreign.leader.userId, title, basePoints: 1, estimatedSeconds: min(1) })))
        .returning()
      await db.insert(taskDependencies).values({ tenantId: foreign.tenant.id, taskId: blocked!.id, dependsOnTaskId: blocker!.id })

      await expect(startTaskFor(f.members[0]!, blocked!.id)).rejects.toThrow('Tarefa não encontrada')
    } finally {
      await foreign.cleanup()
    }
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

describe('usuário sem equipe', () => {
  it('a lista do board vem vazia, sem erro', async () => {
    await newTask(null)
    const teamless = await addUser(f, { role: 'MEMBER', team: null })

    expect(await db.select().from(tasks).where(taskListWhere(teamless, {}))).toEqual([])
  })

  it('não puxa tarefa do pool', async () => {
    const pool = await newTask(null)
    const teamless = await addUser(f, { role: 'MEMBER', team: null })

    await expect(startTaskFor(teamless, pool.id)).rejects.toThrow('Tarefa não encontrada')
  })
})

describe('escopo da lista do board', () => {
  it('quem pede equipe alheia recebe lista vazia, não a da própria equipe', async () => {
    const teamB = await addTeam(f, 'B')
    await db.insert(tasks).values({ tenantId: f.tenant.id, teamId: teamB.id, createdById: f.leader.userId, title: 'da B', basePoints: 1, estimatedSeconds: min(1) })
    const own = await db.select().from(tasks).where(taskListWhere(f.members[0]!, {}))

    const asked = await db.select().from(tasks).where(taskListWhere(f.members[0]!, { teamId: teamB.id }))

    expect(own.length).toBeGreaterThan(0)
    expect(asked).toEqual([])
  })

  it('os membros oferecidos como responsável respeitam o mesmo escopo', async () => {
    const teamB = await addTeam(f, 'B2')
    const inB = await addUser(f, { role: 'MEMBER', team: teamB })
    const admin = await addAdmin(f)

    const ownIds = (await boardMembersFor(f.members[0]!)).map((u) => u.id)
    const alienIds = (await boardMembersFor(f.members[0]!, teamB.id)).map((u) => u.id)
    const adminIds = (await boardMembersFor(admin, teamB.id)).map((u) => u.id)

    expect(ownIds).toContain(f.members[1]!.userId)
    expect(ownIds).not.toContain(inB.userId)
    expect(alienIds).toEqual([])
    expect(adminIds).toEqual([inB.userId])
  })
})

describe('responsável da tarefa', () => {
  it('não atribui a usuário desativado, nem ao criar nem ao editar', async () => {
    const deactivated = await addUser(f, { role: 'MEMBER', team: f.team })
    await db.update(users).set({ banned: true }).where(eq(users.id, deactivated.userId))
    const task = await newTask(null)
    const input = { title: 'Nova', basePoints: 10, estimatedMinutes: 5, teamId: f.team.id }

    await expect(createTaskFor(f.leader, { ...input, assignedToId: deactivated.userId })).rejects.toThrow('Responsável não pertence à equipe')
    await expect(
      updateTaskFor(f.leader, { taskId: task.id, title: 'T', basePoints: 100, estimatedMinutes: 10, priority: 'medium', dueDate: null, scheduledStart: null, scheduledEnd: null, assignedToId: deactivated.userId }),
    ).rejects.toThrow('Responsável não pertence à equipe')
  })
})

describe('startTaskFor lê o vínculo no banco, não no contexto', () => {
  const leave = async (userId: string) => {
    const admin = await addUser(f, { role: 'TENANT_ADMIN', team: null })
    await db.transaction((tx) => removeMember(tx, admin, { teamId: f.team.id, userId }))
  }
  const taskRow = async (id: string) => (await db.select().from(tasks).where(eq(tasks.id, id)))[0]!
  const isMember = async (userId: string) => (await db.select().from(teamMembers).where(eq(teamMembers.userId, userId))).some((m) => m.teamId === f.team.id)

  it('quem acabou de sair da equipe não pega tarefa do pool com o contexto velho', async () => {
    const stale = await addUser(f, { role: 'MEMBER', team: f.team })
    const pool = await newTask(null)
    await leave(stale.userId)

    await expect(startTaskFor(stale, pool.id)).rejects.toThrow('Tarefa não encontrada')

    expect(await taskRow(pool.id)).toMatchObject({ assignedToId: null, status: 'pending' })
  })

  it('sair da equipe e iniciar ao mesmo tempo nunca deixa a tarefa com quem já não é membro', async () => {
    for (let round = 0; round < 8; round++) {
      const me = await addUser(f, { role: 'MEMBER', team: f.team })
      const pool = await newTask(null)

      await Promise.allSettled([startTaskFor(me, pool.id), leave(me.userId)])

      const row = await taskRow(pool.id)
      expect(await isMember(me.userId)).toBe(false)
      expect(row.assignedToId).not.toBe(me.userId)
    }
  })

  it('a tarefa espera a saída da equipe confirmar e então não é entregue a quem saiu', async () => {
    const me = await addUser(f, { role: 'MEMBER', team: f.team })
    const pool = await newTask(null)
    const admin = await addUser(f, { role: 'TENANT_ADMIN', team: null })
    let attempt: Promise<unknown> = Promise.resolve()

    await db.transaction(async (tx) => {
      await removeMember(tx, admin, { teamId: f.team.id, userId: me.userId })
      attempt = startTaskFor(me, pool.id).catch((e: Error) => e.message)
      await new Promise((resolve) => setTimeout(resolve, 200))
    })

    expect(await attempt).toBe('Tarefa não encontrada')
    expect(await taskRow(pool.id)).toMatchObject({ assignedToId: null, status: 'pending' })
  })

  it('retomar a própria tarefa pausada enquanto sai da equipe termina, sem impasse, e a tarefa volta ao pool', async () => {
    for (let round = 0; round < 8; round++) {
      const me = await addUser(f, { role: 'MEMBER', team: f.team })
      const paused = await newTask(me.userId)
      await db.update(tasks).set({ status: 'paused' }).where(eq(tasks.id, paused.id))

      const [started, left] = await Promise.allSettled([startTaskFor(me, paused.id), leave(me.userId)])

      expect(left.status).toBe('fulfilled')
      if (started.status === 'rejected') expect(started.reason.message).toBe('Tarefa não encontrada')
      expect(await taskRow(paused.id)).toMatchObject({ assignedToId: null, status: 'pending' })
    }
  })

  it('quem está em duas equipes pega tarefa do pool da que só integra', async () => {
    const teamB = await addTeam(f, 'B-start')
    const me = await joinTeam(f, (await addUser(f, { role: 'MEMBER', team: f.team })).userId, teamB)
    const [inB] = await db
      .insert(tasks)
      .values({ tenantId: f.tenant.id, teamId: teamB.id, createdById: f.leader.userId, title: 'da B', basePoints: 10, estimatedSeconds: min(5) })
      .returning()

    const started = await startTaskFor(me, inB!.id)

    expect(started).toMatchObject({ assignedToId: me.userId, status: 'in_progress' })
  })
})

describe('opções do formulário de tarefa', () => {
  it('oferece só as equipes que a pessoa gerencia e os membros ativos delas, um por equipe', async () => {
    const teamB = await addTeam(f, 'B-form')
    const teamC = await addTeam(f, 'C-form')
    const leader = await joinTeam(f, (await addUser(f, { role: 'MEMBER', team: f.team, teamRole: 'LEADER' })).userId, teamB)
    const inA = await addUser(f, { role: 'MEMBER', team: f.team })
    const inBoth = await joinTeam(f, (await addUser(f, { role: 'MEMBER', team: f.team })).userId, teamC)
    const inB = await addUser(f, { role: 'MEMBER', team: teamB })
    const banned = await addUser(f, { role: 'MEMBER', team: f.team })
    await db.update(users).set({ banned: true }).where(eq(users.id, banned.userId))

    const options = await taskFormOptionsFor(leader)

    expect(options.teams.map((t) => t.id)).toEqual([f.team.id])
    const pairs = options.members.map((m) => `${m.id}@${m.teamId}`)
    expect(pairs).toEqual(expect.arrayContaining([`${inA.userId}@${f.team.id}`, `${inBoth.userId}@${f.team.id}`]))
    expect(pairs).not.toContain(`${inB.userId}@${teamB.id}`)
    expect(pairs).not.toContain(`${inBoth.userId}@${teamC.id}`)
    expect(pairs.some((p) => p.startsWith(banned.userId))).toBe(false)
  })

  it('admin vê todas as equipes do tenant, e membro comum não oferece nada', async () => {
    const admin = await addUser(f, { role: 'TENANT_ADMIN', team: null })
    const teamB = await addTeam(f, 'B-form-admin')

    const asAdmin = await taskFormOptionsFor(admin)
    const asMember = await taskFormOptionsFor(f.members[0]!)

    expect(asAdmin.teams.map((t) => t.id)).toEqual(expect.arrayContaining([f.team.id, teamB.id]))
    expect(asMember).toEqual({ teams: [], members: [] })
  })
})
