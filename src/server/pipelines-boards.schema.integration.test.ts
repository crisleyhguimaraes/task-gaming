import { and, eq, isNull } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { boardTeams, boards, leads, opportunities, pipelineStages, pipelines, tasks, teamPipelines, teams, tenants } from '#/db/schema'
import { addTeam, makeTenant } from './test-fixtures'

const FOREIGN_KEY_VIOLATION = '23503'
const UNIQUE_VIOLATION = '23505'

afterAll(() => db.$client.end())

const insertBoard = (tenantId: string, name: string, archivedAt: Date | null = null) => db.insert(boards).values({ tenantId, name, archivedAt }).returning()
const insertPipeline = (tenantId: string, name: string, archivedAt: Date | null = null) => db.insert(pipelines).values({ tenantId, name, archivedAt }).returning()
const insertTask = (tenantId: string, teamId: string, boardId: string | null) =>
  db.insert(tasks).values({ tenantId, teamId, boardId, title: 'T', basePoints: 1, estimatedSeconds: 60 })

describe('nome único de equipe', () => {
  it('é decidido pelo banco, sem diferenciar maiúsculas nem espaços, e vale por tenant', async () => {
    const a = await makeTenant(0)
    const b = await makeTenant(0)
    try {
      await addTeam(a, 'Suporte')

      await expect(addTeam(a, '  SUPORTE ')).rejects.toMatchObject({ cause: { code: UNIQUE_VIOLATION } })
      await expect(addTeam(b, 'Suporte')).resolves.toMatchObject({ name: 'Suporte' })
    } finally {
      await a.cleanup()
      await b.cleanup()
    }
  })
})

describe('pipelines no banco', () => {
  it('cada tenant tem um só pipeline padrão', async () => {
    const f = await makeTenant(0)
    try {
      await expect(db.insert(pipelines).values({ tenantId: f.tenant.id, name: 'Outro padrão', isDefault: true })).rejects.toMatchObject({ cause: { code: UNIQUE_VIOLATION } })
    } finally {
      await f.cleanup()
    }
  })

  it('o nome é único entre os ativos e fica livre quando o pipeline é arquivado', async () => {
    const f = await makeTenant(0)
    try {
      await insertPipeline(f.tenant.id, 'Parcerias', new Date())

      await insertPipeline(f.tenant.id, ' parcerias ')
      await insertPipeline(f.tenant.id, 'PARCERIAS', new Date())
      await expect(insertPipeline(f.tenant.id, 'Parcerias')).rejects.toMatchObject({ cause: { code: UNIQUE_VIOLATION } })
    } finally {
      await f.cleanup()
    }
  })

  it('etapa de um tenant não entra no pipeline de outro, e pipeline com etapas não se apaga', async () => {
    const a = await makeTenant(0)
    const b = await makeTenant(0)
    try {
      const crossTenant = db.insert(pipelineStages).values({ tenantId: a.tenant.id, pipelineId: b.pipeline.id, name: 'Invasora', sortOrder: 99 })

      await expect(crossTenant).rejects.toMatchObject({ cause: { code: FOREIGN_KEY_VIOLATION } })
      await expect(db.delete(pipelines).where(eq(pipelines.id, a.pipeline.id))).rejects.toMatchObject({ cause: { code: FOREIGN_KEY_VIOLATION } })
    } finally {
      await a.cleanup()
      await b.cleanup()
    }
  })

  it('apagar o tenant leva pipelines, etapas, oportunidades e vínculos, sem as FKs restrict barrarem a cascata', async () => {
    const f = await makeTenant(0)
    const [lead] = await db.insert(leads).values({ tenantId: f.tenant.id, teamId: f.team.id, name: 'Lead' }).returning()
    const [stage] = await db.select().from(pipelineStages).where(eq(pipelineStages.pipelineId, f.pipeline.id)).limit(1)
    await db.insert(opportunities).values({ tenantId: f.tenant.id, teamId: f.team.id, leadId: lead!.id, title: 'Negócio', pipelineId: f.pipeline.id, stageId: stage!.id })
    await db.insert(teamPipelines).values({ pipelineId: f.pipeline.id, teamId: f.team.id, tenantId: f.tenant.id })
    const [board] = await insertBoard(f.tenant.id, 'Quadro')
    await db.insert(boardTeams).values({ boardId: board!.id, teamId: f.team.id, tenantId: f.tenant.id })
    await insertTask(f.tenant.id, f.team.id, board!.id)

    await expect(f.cleanup()).resolves.toBeDefined()

    expect(await db.select().from(tenants).where(eq(tenants.id, f.tenant.id))).toHaveLength(0)
    expect(await db.select().from(pipelines).where(eq(pipelines.tenantId, f.tenant.id))).toHaveLength(0)
    expect(await db.select().from(boards).where(eq(boards.tenantId, f.tenant.id))).toHaveLength(0)
  })

  it('apagar a equipe leva os vínculos e preserva pipeline e board', async () => {
    const f = await makeTenant(0)
    try {
      const extra = await addTeam(f)
      const [board] = await insertBoard(f.tenant.id, 'Quadro')
      await db.insert(teamPipelines).values({ pipelineId: f.pipeline.id, teamId: extra.id, tenantId: f.tenant.id })
      await db.insert(boardTeams).values({ boardId: board!.id, teamId: extra.id, tenantId: f.tenant.id })

      await db.delete(teams).where(eq(teams.id, extra.id))

      expect(await db.select().from(teamPipelines).where(eq(teamPipelines.teamId, extra.id))).toHaveLength(0)
      expect(await db.select().from(boardTeams).where(eq(boardTeams.teamId, extra.id))).toHaveLength(0)
      expect(await db.select().from(pipelines).where(eq(pipelines.id, f.pipeline.id))).toHaveLength(1)
      expect(await db.select().from(boards).where(eq(boards.id, board!.id))).toHaveLength(1)
    } finally {
      await f.cleanup()
    }
  })
})

describe('boards no banco', () => {
  it('o nome é único entre os ativos, sem diferenciar maiúsculas, e vale por tenant', async () => {
    const a = await makeTenant(0)
    const b = await makeTenant(0)
    try {
      await insertBoard(a.tenant.id, 'Sprint')
      await insertBoard(a.tenant.id, 'sprint', new Date())

      await expect(insertBoard(a.tenant.id, ' SPRINT ')).rejects.toMatchObject({ cause: { code: UNIQUE_VIOLATION } })
      await expect(insertBoard(b.tenant.id, 'Sprint')).resolves.toHaveLength(1)
    } finally {
      await a.cleanup()
      await b.cleanup()
    }
  })

  it('vínculo de board entre tenants é rejeitado nos dois sentidos', async () => {
    const a = await makeTenant(0)
    const b = await makeTenant(0)
    try {
      const [boardA] = await insertBoard(a.tenant.id, 'Quadro A')

      const teamOfB = db.insert(boardTeams).values({ boardId: boardA!.id, teamId: b.team.id, tenantId: a.tenant.id })
      const boardOfA = db.insert(boardTeams).values({ boardId: boardA!.id, teamId: b.team.id, tenantId: b.tenant.id })

      await expect(teamOfB).rejects.toMatchObject({ cause: { code: FOREIGN_KEY_VIOLATION } })
      await expect(boardOfA).rejects.toMatchObject({ cause: { code: FOREIGN_KEY_VIOLATION } })
    } finally {
      await a.cleanup()
      await b.cleanup()
    }
  })

  it('tarefa sem board é válida, board de outro tenant é rejeitado e board com tarefa não se apaga', async () => {
    const a = await makeTenant(0)
    const b = await makeTenant(0)
    try {
      const [boardA] = await insertBoard(a.tenant.id, 'Quadro A')
      const [boardB] = await insertBoard(b.tenant.id, 'Quadro B')

      await insertTask(a.tenant.id, a.team.id, null)
      await insertTask(a.tenant.id, a.team.id, boardA!.id)

      await expect(insertTask(a.tenant.id, a.team.id, boardB!.id)).rejects.toMatchObject({ cause: { code: FOREIGN_KEY_VIOLATION } })
      await expect(db.delete(boards).where(eq(boards.id, boardA!.id))).rejects.toMatchObject({ cause: { code: FOREIGN_KEY_VIOLATION } })
      expect(await db.select().from(tasks).where(and(eq(tasks.tenantId, a.tenant.id), isNull(tasks.boardId)))).toHaveLength(1)
    } finally {
      await a.cleanup()
      await b.cleanup()
    }
  })
})
