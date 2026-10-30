import { and, asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { auditEvents, tasks, teams, users } from '#/db/schema'
import { exportAuditCsvFor, exportTasksCsvFor } from './exports.core'
import type { AuthCtx } from './roles'
import { addAdmin, makeTenant } from './test-fixtures'

const BOM = '﻿'

let f: Awaited<ReturnType<typeof makeTenant>>
let other: Awaited<ReturnType<typeof makeTenant>>
let admin: AuthCtx
let rival: AuthCtx

const newTask = async (title: string, patch: Partial<typeof tasks.$inferInsert> = {}) => {
  const [t] = await db
    .insert(tasks)
    .values({ tenantId: f.tenant.id, teamId: f.team.id, createdById: f.leader.userId, title, basePoints: 100, estimatedSeconds: 600, ...patch })
    .returning()
  return t!
}

const dataLines = (content: string) => content.slice(BOM.length).split('\r\n').slice(1, -1)

const exportEvents = (tenantId: string) =>
  db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.tenantId, tenantId), eq(auditEvents.action, 'export.created')))
    .orderBy(asc(auditEvents.createdAt))

beforeAll(async () => {
  f = await makeTenant(1)
  other = await makeTenant(1)
  admin = await addAdmin(f)
  const [team2] = await db.insert(teams).values({ tenantId: f.tenant.id, name: 'Outra' }).returning()
  const id = `rival-${f.tenant.slug}`
  await db.insert(users).values({ id, name: 'Rival', email: `${id}@test.local`, role: 'TEAM_LEADER', tenantId: f.tenant.id, teamId: team2!.id })
  rival = { ...f.leader, userId: id, teamId: team2!.id, name: 'Rival' }
  await newTask('Da equipe principal', { priority: 'high', assignedToId: f.members[0]!.userId })
  await newTask('Da outra equipe', { teamId: team2!.id })
  await newTask('=HYPERLINK("http://evil","clique")')
  await db.insert(tasks).values({ tenantId: other.tenant.id, teamId: other.team.id, createdById: other.leader.userId, title: 'De outro tenant', basePoints: 1, estimatedSeconds: 60 })
})
afterAll(async () => {
  await f.cleanup()
  await other.cleanup()
  await db.$client.end()
})

describe('exportar tarefas', () => {
  it('devolve arquivo CSV com BOM, cabeçalho em português e nome datado', async () => {
    const { filename, content } = await exportTasksCsvFor(admin, {})

    expect(filename).toMatch(/^tarefas-\d{4}-\d{2}-\d{2}\.csv$/)
    expect(content.startsWith(`${BOM}Título;`)).toBe(true)
  })

  it('admin recebe o tenant inteiro, sem tarefas de outro tenant', async () => {
    const { content } = await exportTasksCsvFor(admin, {})

    expect(content).toContain('Da equipe principal')
    expect(content).toContain('Da outra equipe')
    expect(content).not.toContain('De outro tenant')
  })

  it('líder recebe só a própria equipe, como na lista do board', async () => {
    const { content } = await exportTasksCsvFor(f.leader, {})

    expect(content).toContain('Da equipe principal')
    expect(content).not.toContain('Da outra equipe')
  })

  it('aplica os mesmos filtros da lista', async () => {
    const { content } = await exportTasksCsvFor(admin, { priority: 'high' })

    expect(dataLines(content)).toHaveLength(1)
    expect(content).toContain('Da equipe principal')
  })

  it('neutraliza fórmulas no título', async () => {
    const { content } = await exportTasksCsvFor(admin, { search: 'HYPERLINK' })

    expect(content).toContain(`"'=HYPERLINK(""http://evil"",""clique"")"`)
  })

  it('registra a exportação com tipo e quantidade de linhas', async () => {
    const before = (await exportEvents(f.tenant.id)).length

    await exportTasksCsvFor(admin, { priority: 'high' })

    const events = await exportEvents(f.tenant.id)
    expect(events).toHaveLength(before + 1)
    expect(events.at(-1)).toMatchObject({ actorId: admin.userId, meta: { kind: 'tasks', rows: 1 } })
  })

  it('recusa quando passa do limite de linhas, sem registrar exportação', async () => {
    const before = (await exportEvents(f.tenant.id)).length

    await expect(exportTasksCsvFor(admin, {}, 2)).rejects.toThrow('limite')

    expect(await exportEvents(f.tenant.id)).toHaveLength(before)
  })

  it('membro não tem a capability', async () => {
    await expect(exportTasksCsvFor(f.members[0]!, {})).rejects.toThrow('Sem permissão')
  })

  it('líder de outra equipe não enxerga nada da equipe principal', async () => {
    const { content } = await exportTasksCsvFor(rival, {})

    expect(content).toContain('Da outra equipe')
    expect(content).not.toContain('Da equipe principal')
  })
})

describe('exportar auditoria', () => {
  beforeAll(async () => {
    const rows = Array.from({ length: 450 }, (_, i) => ({
      tenantId: f.tenant.id,
      actorId: admin.userId,
      actorName: admin.name,
      action: 'task.updated',
      entityType: 'task',
      entityId: `lote-${i}`,
      changes: { title: { from: 'a', to: '=b' } },
    }))
    await db.insert(auditEvents).values(rows)
    await db.insert(auditEvents).values({ tenantId: other.tenant.id, actorId: 'x', actorName: 'Intruso', action: 'task.updated', entityType: 'task', entityId: 'alheio' })
  })

  it('percorre todas as páginas e só traz o tenant da sessão', async () => {
    const { filename, content } = await exportAuditCsvFor(admin, { entityType: 'task', action: 'task.updated' })

    expect(filename).toMatch(/^auditoria-\d{4}-\d{2}-\d{2}\.csv$/)
    expect(dataLines(content)).toHaveLength(450)
    expect(content).not.toContain('Intruso')
  })

  it('escreve a mudança de forma legível', async () => {
    const { content } = await exportAuditCsvFor(admin, { entityId: 'lote-1' })

    expect(content).toContain(`Tarefa editada`)
    expect(content).toContain('title: a → =b')
  })

  it('registra a exportação de auditoria', async () => {
    await exportAuditCsvFor(admin, { entityId: 'lote-2' })

    const events = await exportEvents(f.tenant.id)
    expect(events.at(-1)).toMatchObject({ meta: { kind: 'audit', rows: 1 } })
  })

  it('exige também audit.read: líder pode exportar tarefas mas não auditoria', async () => {
    await expect(exportAuditCsvFor(f.leader, {})).rejects.toThrow('Sem permissão')
    await expect(exportAuditCsvFor(f.members[0]!, {})).rejects.toThrow('Sem permissão')
  })

  it('recusa quando passa do limite de linhas', async () => {
    await expect(exportAuditCsvFor(admin, { entityType: 'task' }, 100)).rejects.toThrow('limite')
  })
})
