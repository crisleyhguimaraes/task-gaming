import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { auditEvents, leads, opportunities, opportunityStageChanges, pipelineStages } from '#/db/schema'
import type { StageKind } from '#/db/schema'
import type { AuthCtx } from './roles'
import { createStageFor, deleteStageFor, listStagesFor, reorderStageFor, updateStageFor } from './stages.core'
import { addAdmin, makeTenant } from './test-fixtures'

let f: Awaited<ReturnType<typeof makeTenant>>
let other: Awaited<ReturnType<typeof makeTenant>>
let solo: Awaited<ReturnType<typeof makeTenant>>
let admin: AuthCtx
let otherAdmin: AuthCtx
let soloAdmin: AuthCtx

const stageByName = async (name: string) => {
  const stages = await listStagesFor(admin)
  return stages.find((s) => s.name === name)!
}

async function opportunityIn(stageId: string) {
  const [lead] = await db.insert(leads).values({ tenantId: f.tenant.id, teamId: f.team.id, name: 'Lead' }).returning()
  const [opp] = await db.insert(opportunities).values({ tenantId: f.tenant.id, teamId: f.team.id, leadId: lead!.id, title: 'Negócio', stageId }).returning()
  return opp!
}

const auditActions = async (entityId: string) =>
  (await db.select({ action: auditEvents.action }).from(auditEvents).where(and(eq(auditEvents.tenantId, f.tenant.id), eq(auditEvents.entityId, entityId)))).map((e) => e.action)

const newStage = (name: string, kind: StageKind = 'open', probability = 30) => createStageFor(admin, { name, kind, probability })

beforeAll(async () => {
  f = await makeTenant(1)
  other = await makeTenant(0)
  solo = await makeTenant(0)
  admin = await addAdmin(f)
  otherAdmin = await addAdmin(other)
  soloAdmin = await addAdmin(solo)
})
afterAll(async () => {
  await f.cleanup()
  await other.cleanup()
  await solo.cleanup()
  await db.$client.end()
})

describe('listStagesFor', () => {
  it('lista as etapas do próprio tenant em ordem, para qualquer papel', async () => {
    const stages = await listStagesFor(other.leader)

    expect(stages.map((s) => s.name)).toEqual(['Novo', 'Qualificado', 'Proposta', 'Negociação', 'Ganha', 'Perdida'])
    expect(stages.every((s) => s.tenantId === other.tenant.id)).toBe(true)
  })

  it('marca como em uso a etapa que já tem oportunidade ou histórico', async () => {
    const stage = await newStage('Em uso')
    expect((await listStagesFor(admin)).find((s) => s.id === stage.id)!.inUse).toBe(false)

    await opportunityIn(stage.id)

    expect((await listStagesFor(admin)).find((s) => s.id === stage.id)!.inUse).toBe(true)
  })
})

describe('createStageFor', () => {
  it('só quem tem pipeline.configure cria etapa', async () => {
    await expect(createStageFor(f.leader, { name: 'X1', kind: 'open', probability: 10 })).rejects.toThrow('Sem permissão')
    await expect(createStageFor(f.members[0]!, { name: 'X2', kind: 'open', probability: 10 })).rejects.toThrow('Sem permissão')
  })

  it('a nova etapa fica logo depois da última do mesmo tipo e é auditada', async () => {
    const stage = await newStage('Diagnóstico', 'open', 40)

    const names = (await listStagesFor(admin)).map((s) => s.name)
    expect(names.indexOf('Diagnóstico')).toBe(names.indexOf('Ganha') - 1)
    expect(stage).toMatchObject({ name: 'Diagnóstico', kind: 'open', probability: 40, tenantId: f.tenant.id })
    expect(await auditActions(stage.id)).toEqual(['pipeline.stage_created'])
  })

  it('recusa nome curto e probabilidade fora de 0–100', async () => {
    await expect(newStage(' a ')).rejects.toThrow('nome')
    await expect(newStage('Alta', 'open', 101)).rejects.toThrow('Probabilidade')
    await expect(newStage('Baixa', 'open', -1)).rejects.toThrow('Probabilidade')
    await expect(newStage('Quebrada', 'open', 10.5)).rejects.toThrow('Probabilidade')
  })
})

describe('updateStageFor', () => {
  it('renomeia e ajusta probabilidade registrando o diff', async () => {
    const stage = await newStage('Rascunho')

    const updated = await updateStageFor(admin, stage.id, { name: 'Reunião marcada', probability: 60 })

    expect(updated).toMatchObject({ name: 'Reunião marcada', probability: 60 })
    const [event] = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, stage.id), eq(auditEvents.action, 'pipeline.stage_updated')))
    expect(event!.changes).toEqual({ name: { from: 'Rascunho', to: 'Reunião marcada' }, probability: { from: 30, to: 60 } })
  })

  it('não grava evento quando nada mudou', async () => {
    const stage = await newStage('Igual')

    await updateStageFor(admin, stage.id, { name: 'Igual', probability: 30 })

    expect(await auditActions(stage.id)).toEqual(['pipeline.stage_created'])
  })

  it('recusa probabilidade inválida e etapa de outro tenant', async () => {
    const mine = await stageByName('Proposta')

    await expect(updateStageFor(admin, mine.id, { probability: 150 })).rejects.toThrow('Probabilidade')
    await expect(updateStageFor(otherAdmin, mine.id, { name: 'Invadida' })).rejects.toThrow('Etapa não encontrada')
    expect((await stageByName('Proposta')).name).toBe('Proposta')
  })

  it('só admin altera etapa', async () => {
    const mine = await stageByName('Proposta')

    await expect(updateStageFor(f.leader, mine.id, { name: 'Líder' })).rejects.toThrow('Sem permissão')
  })

  it('troca o tipo de uma etapa nunca usada quando sobra ao menos uma de cada tipo', async () => {
    const stage = await newStage('Vai virar ganha')

    const updated = await updateStageFor(admin, stage.id, { kind: 'won' })

    expect(updated.kind).toBe('won')
  })

  it('recusa trocar o tipo que deixaria o tenant sem etapa ganha ou perdida', async () => {
    const stages = await listStagesFor(soloAdmin)
    const won = stages.find((s) => s.kind === 'won')!
    const lost = stages.find((s) => s.kind === 'lost')!

    await expect(updateStageFor(soloAdmin, won.id, { kind: 'open' })).rejects.toThrow('ganha')
    await expect(updateStageFor(soloAdmin, lost.id, { kind: 'open' })).rejects.toThrow('perdida')
  })

  it('recusa trocar o tipo de etapa que já teve oportunidade', async () => {
    const stage = await newStage('Já usada')
    await opportunityIn(stage.id)

    await expect(updateStageFor(admin, stage.id, { kind: 'lost' })).rejects.toThrow('já foi usada')
  })
})

describe('reorderStageFor', () => {
  it('muda a posição e audita', async () => {
    const [first, second] = await listStagesFor(admin)

    await reorderStageFor(admin, second!.id, first!.sortOrder - 1)

    expect((await listStagesFor(admin))[0]!.id).toBe(second!.id)
    expect(await auditActions(second!.id)).toContain('pipeline.stage_updated')
  })

  it('recusa posição que não é número finito', async () => {
    const stage = await stageByName('Novo')

    await expect(reorderStageFor(admin, stage.id, Number.NaN)).rejects.toThrow('Posição')
  })

  it('só admin reordena', async () => {
    const stage = await stageByName('Novo')

    await expect(reorderStageFor(f.leader, stage.id, 0)).rejects.toThrow('Sem permissão')
  })
})

describe('deleteStageFor', () => {
  it('exclui etapa nunca usada e audita', async () => {
    const stage = await newStage('Descartável')

    await deleteStageFor(admin, stage.id)

    expect((await listStagesFor(admin)).some((s) => s.id === stage.id)).toBe(false)
    expect(await auditActions(stage.id)).toEqual(['pipeline.stage_created', 'pipeline.stage_deleted'])
  })

  it('recusa etapa com oportunidade', async () => {
    const stage = await newStage('Ocupada')
    await opportunityIn(stage.id)

    await expect(deleteStageFor(admin, stage.id)).rejects.toThrow('já foi usada')
  })

  it('recusa etapa que só aparece no histórico de mudanças', async () => {
    const used = await newStage('Passou por aqui')
    const current = await stageByName('Novo')
    const opp = await opportunityIn(current.id)
    await db.insert(opportunityStageChanges).values({ tenantId: f.tenant.id, opportunityId: opp.id, fromStageId: used.id, toStageId: current.id })

    await expect(deleteStageFor(admin, used.id)).rejects.toThrow('já foi usada')
  })

  it('recusa apagar a última etapa de um tipo', async () => {
    const stages = await listStagesFor(soloAdmin)
    const won = stages.find((s) => s.kind === 'won')!
    const lost = stages.find((s) => s.kind === 'lost')!

    await expect(deleteStageFor(soloAdmin, won.id)).rejects.toThrow('ganha')
    await expect(deleteStageFor(soloAdmin, lost.id)).rejects.toThrow('perdida')
  })

  it('apaga uma etapa de um tipo quando existe outra do mesmo tipo', async () => {
    const extra = await newStage('Perdida por preço', 'lost', 0)

    await deleteStageFor(admin, extra.id)

    expect((await listStagesFor(admin)).filter((s) => s.kind === 'lost')).toHaveLength(1)
  })

  it('não apaga etapa de outro tenant nem deixa líder apagar', async () => {
    const mine = await newStage('Protegida')

    await expect(deleteStageFor(otherAdmin, mine.id)).rejects.toThrow('Etapa não encontrada')
    await expect(deleteStageFor(f.leader, mine.id)).rejects.toThrow('Sem permissão')
    expect(await db.select().from(pipelineStages).where(eq(pipelineStages.id, mine.id))).toHaveLength(1)
  })
})
