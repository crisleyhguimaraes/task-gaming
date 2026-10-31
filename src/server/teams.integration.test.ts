import { and, asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { auditEvents, boardTeams, boards, pipelines, teamPipelines, teams } from '#/db/schema'
import type { AuthCtx } from './roles'
import { archiveBoardFor, createBoardFor } from './boards.core'
import { createGoalFor, setGoalTeamsFor } from './goals.core'
import { setCapabilityFor } from './permissions.core'
import { archivePipelineFor, createPipelineFor, linkTeamToPipelineFor } from './pipelines.core'
import { FACTORY_RULES } from './scoring'
import { createScoringRuleFor, setScoringRuleTeamsFor } from './scoring-rules.core'
import { createTeamFor, deleteTeamFor, listTeamsFor, teamDetailFor, updateTeamFor } from './teams.core'
import { addAdmin, addTeam, addUser, ctxFor, joinTeam, makeTenant } from './test-fixtures'

type Fixture = Awaited<ReturnType<typeof makeTenant>>

let f: Fixture
let other: Fixture
let admin: AuthCtx
let otherAdmin: AuthCtx

const auditFor = (entityId: string) =>
  db.select().from(auditEvents).where(and(eq(auditEvents.tenantId, f.tenant.id), eq(auditEvents.entityId, entityId))).orderBy(asc(auditEvents.createdAt), asc(auditEvents.id))

const reload = async (id: string) => (await db.select().from(teams).where(eq(teams.id, id)))[0]!

let sequence = 0
const uniqueName = (label: string) => `${label} ${++sequence}`

beforeAll(async () => {
  f = await makeTenant(1)
  other = await makeTenant(0)
  admin = await addAdmin(f)
  otherAdmin = await addAdmin(other)
})
afterAll(async () => {
  await f.cleanup()
  await other.cleanup()
  await db.$client.end()
})

describe('updateTeamFor', () => {
  it('grava nome e descrição aparados e audita o antes e o depois', async () => {
    const team = await addTeam(f, uniqueName('Antiga'))

    const updated = await updateTeamFor(admin, team.id, { name: '  Vendas SP ', description: '  Time de campo  ' })

    expect(updated).toMatchObject({ name: 'Vendas SP', description: 'Time de campo' })
    const [event] = await auditFor(team.id)
    expect(event).toMatchObject({
      action: 'team.updated',
      changes: { name: { from: team.name, to: 'Vendas SP' }, description: { from: null, to: 'Time de campo' } },
    })
  })

  it('descrição em branco limpa o campo', async () => {
    const team = await addTeam(f, uniqueName('Com texto'))
    await updateTeamFor(admin, team.id, { name: team.name, description: 'Algo' })

    await updateTeamFor(admin, team.id, { name: team.name, description: '   ' })

    expect((await reload(team.id)).description).toBeNull()
  })

  it('não grava evento quando nada muda', async () => {
    const team = await addTeam(f, uniqueName('Igual'))

    await updateTeamFor(admin, team.id, { name: ` ${team.name} `, description: '' })

    expect(await auditFor(team.id)).toHaveLength(0)
  })

  it('recusa nome e descrição fora dos limites', async () => {
    const team = await addTeam(f, uniqueName('Limites'))

    await expect(updateTeamFor(admin, team.id, { name: ' a ', description: '' })).rejects.toThrow('nome')
    await expect(updateTeamFor(admin, team.id, { name: 'x'.repeat(101), description: '' })).rejects.toThrow('nome')
    await expect(updateTeamFor(admin, team.id, { name: team.name, description: 'x'.repeat(301) })).rejects.toThrow('descrição')
    expect((await reload(team.id)).name).toBe(team.name)
  })

  it('recusa nome de outra equipe sem diferenciar maiúsculas, mas aceita o mesmo nome em outro tenant', async () => {
    const taken = await addTeam(f, uniqueName('Ocupada'))
    const mine = await addTeam(f, uniqueName('Minha'))
    const alien = await addTeam(other)

    await expect(updateTeamFor(admin, mine.id, { name: `  ${taken.name.toUpperCase()} `, description: '' })).rejects.toThrow('Já existe uma equipe com esse nome')
    await expect(updateTeamFor(otherAdmin, alien.id, { name: taken.name, description: '' })).resolves.toMatchObject({ name: taken.name })
    expect((await reload(mine.id)).name).toBe(mine.name)
  })

  it('mudar só a caixa do próprio nome é permitido', async () => {
    const team = await addTeam(f, uniqueName('caixa'))

    await expect(updateTeamFor(admin, team.id, { name: team.name.toUpperCase(), description: '' })).resolves.toMatchObject({ name: team.name.toUpperCase() })
  })

  it('só quem tem team.manage edita, e líder da própria equipe não', async () => {
    await expect(updateTeamFor(f.leader, f.team.id, { name: 'Invadida', description: '' })).rejects.toThrow('Sem permissão')
    await expect(updateTeamFor(f.members[0]!, f.team.id, { name: 'Invadida', description: '' })).rejects.toThrow('Sem permissão')
  })

  it('equipe de outro tenant é "não encontrada" e continua intacta', async () => {
    const team = await addTeam(f, uniqueName('Alheia'))

    await expect(updateTeamFor(otherAdmin, team.id, { name: 'Invadida', description: '' })).rejects.toThrow('Equipe não encontrada')
    expect((await reload(team.id)).name).toBe(team.name)
  })

  it('dois renomes simultâneos para o mesmo nome: um vence e o outro recebe a mensagem, não um erro de banco', async () => {
    const [a, b] = [await addTeam(f, uniqueName('Corrida A')), await addTeam(f, uniqueName('Corrida B'))]
    const name = uniqueName('Disputada')

    const results = await Promise.allSettled([updateTeamFor(admin, a.id, { name, description: '' }), updateTeamFor(admin, b.id, { name, description: '' })])

    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(String(rejected[0]!.reason)).toContain('Já existe uma equipe com esse nome')
    expect(await db.select().from(teams).where(and(eq(teams.tenantId, f.tenant.id), eq(teams.name, name)))).toHaveLength(1)
  })
})

describe('createTeamFor e deleteTeamFor exigem team.manage dentro do core', () => {
  it('líder e membro não criam nem excluem', async () => {
    const team = await addTeam(f, uniqueName('Protegida'))

    await expect(createTeamFor(f.leader, uniqueName('Nova'))).rejects.toThrow('Sem permissão')
    await expect(deleteTeamFor(f.leader, team.id)).rejects.toThrow('Sem permissão')
    await expect(deleteTeamFor(f.members[0]!, team.id)).rejects.toThrow('Sem permissão')
    expect(await reload(team.id)).toBeDefined()
  })

  it('o evento team.deleted registra quantos pipelines e boards foram desvinculados', async () => {
    const team = await addTeam(f, uniqueName('Vinculada'))
    const [pipelineA, pipelineB] = await db
      .insert(pipelines)
      .values([
        { tenantId: f.tenant.id, name: uniqueName('Funil') },
        { tenantId: f.tenant.id, name: uniqueName('Funil') },
      ])
      .returning()
    await db.insert(teamPipelines).values([pipelineA!, pipelineB!].map((p) => ({ pipelineId: p.id, teamId: team.id, tenantId: f.tenant.id })))
    const [board] = await db.insert(boards).values({ tenantId: f.tenant.id, name: uniqueName('Quadro') }).returning()
    await db.insert(boardTeams).values({ boardId: board!.id, teamId: team.id, tenantId: f.tenant.id })

    await deleteTeamFor(admin, team.id)

    const events = await auditFor(team.id)
    expect(events.at(-1)).toMatchObject({ action: 'team.deleted', meta: { name: team.name, unlinkedPipelines: 2, unlinkedBoards: 1 } })
    expect(await db.select().from(teamPipelines).where(eq(teamPipelines.teamId, team.id))).toHaveLength(0)
    expect(await db.select().from(boardTeams).where(eq(boardTeams.teamId, team.id))).toHaveLength(0)
  })

  it('equipe sem vínculos registra zero', async () => {
    const team = await addTeam(f, uniqueName('Solta'))

    await deleteTeamFor(admin, team.id)

    expect((await auditFor(team.id)).at(-1)).toMatchObject({ action: 'team.deleted', meta: { unlinkedPipelines: 0, unlinkedBoards: 0 } })
  })
})

describe('listTeamsFor', () => {
  it('devolve a descrição de cada equipe', async () => {
    const team = await addTeam(f, uniqueName('Descrita'))
    await updateTeamFor(admin, team.id, { name: team.name, description: 'Atende o varejo' })
    await addUser(f, { role: 'MEMBER', team })

    const list = await listTeamsFor(admin)

    expect(list.find((t) => t.id === team.id)).toMatchObject({ description: 'Atende o varejo', members: 1 })
  })
})

describe('teamDetailFor', () => {
  async function linkedTeam() {
    const team = await addTeam(f, uniqueName('Detalhe'))
    const leader = await addUser(f, { role: 'MEMBER', team, teamRole: 'LEADER' })
    const member = await addUser(f, { role: 'MEMBER', team })
    const [linked, archived, free] = [await createPipelineFor(admin, uniqueName('Funil')), await createPipelineFor(admin, uniqueName('Funil')), await createPipelineFor(admin, uniqueName('Funil'))]
    await linkTeamToPipelineFor(admin, linked.id, team.id)
    await linkTeamToPipelineFor(admin, archived.id, team.id)
    await archivePipelineFor(admin, archived.id)
    const board = await createBoardFor(admin, { name: uniqueName('Quadro'), teamIds: [team.id] })
    const archivedBoard = await createBoardFor(admin, { name: uniqueName('Quadro'), teamIds: [team.id] })
    await archiveBoardFor(admin, archivedBoard.id)
    const freeBoard = await createBoardFor(admin, { name: uniqueName('Quadro'), teamIds: [] })
    return { team, leader, member, linked, archived, free, board, archivedBoard, freeBoard }
  }

  it('admin vê a equipe, os membros com papel, os vínculos e o que ainda dá para vincular', async () => {
    const x = await linkedTeam()

    const detail = await teamDetailFor(admin, x.team.id)

    expect(detail.team).toMatchObject({ id: x.team.id, name: x.team.name, description: null })
    expect(detail.members.map((m) => [m.userId, m.role])).toEqual([[x.leader.userId, 'LEADER'], [x.member.userId, 'MEMBER']])
    expect(detail.pipelines.map((p) => [p.id, p.archived]).sort()).toEqual([[x.linked.id, false], [x.archived.id, true]].sort())
    expect(detail.boards.map((b) => [b.id, b.archived]).sort()).toEqual([[x.board.id, false], [x.archivedBoard.id, true]].sort())
    expect(detail.defaultPipeline).toMatchObject({ id: f.pipeline.id })
    expect(detail.availablePipelines.map((p) => p.id)).toContain(x.free.id)
    expect(detail.availablePipelines.map((p) => p.id)).not.toContain(x.linked.id)
    expect(detail.availablePipelines.map((p) => p.id)).not.toContain(x.archived.id)
    expect(detail.availableBoards.map((b) => b.id)).toContain(x.freeBoard.id)
    expect(detail.availableBoards.map((b) => b.id)).not.toContain(x.board.id)
    expect(detail.availableBoards.map((b) => b.id)).not.toContain(x.archivedBoard.id)
  })

  it('líder com team.link só recebe como opção os boards que o servidor deixaria vincular', async () => {
    const mine = await addTeam(f, uniqueName('Minha'))
    const alsoMine = await addTeam(f, uniqueName('Outra minha'))
    const theirs = await addTeam(f, uniqueName('Alheia'))
    const leader = await addUser(f, { role: 'MEMBER', team: mine, teamRole: 'LEADER' })
    await joinTeam(f, leader.userId, alsoMine, 'LEADER')
    await setCapabilityFor(admin, 'LEADER', 'team.link', true)
    try {
      const ownBoard = await createBoardFor(admin, { name: uniqueName('Quadro meu'), teamIds: [mine.id] })
      const foreignBoard = await createBoardFor(admin, { name: uniqueName('Quadro alheio'), teamIds: [theirs.id] })
      const sharedBoard = await createBoardFor(admin, { name: uniqueName('Quadro misto'), teamIds: [mine.id, theirs.id] })
      const unlinkedBoard = await createBoardFor(admin, { name: uniqueName('Quadro solto'), teamIds: [] })

      const asLeader = (await teamDetailFor(await ctxFor(leader.userId), alsoMine.id)).availableBoards.map((b) => b.id)
      const asAdmin = (await teamDetailFor(admin, alsoMine.id)).availableBoards.map((b) => b.id)

      expect(asLeader).toContain(ownBoard.id)
      for (const hidden of [foreignBoard.id, sharedBoard.id, unlinkedBoard.id]) expect(asLeader).not.toContain(hidden)
      for (const visible of [ownBoard.id, foreignBoard.id, sharedBoard.id, unlinkedBoard.id]) expect(asAdmin).toContain(visible)
    } finally {
      await setCapabilityFor(admin, 'LEADER', 'team.link', false)
    }
  })

  it('membro da equipe vê tudo em leitura: sem opções de vínculo', async () => {
    const x = await linkedTeam()

    const detail = await teamDetailFor(x.member, x.team.id)

    expect(detail.pipelines).toHaveLength(2)
    expect(detail.boards).toHaveLength(2)
    expect(detail.availablePipelines).toEqual([])
    expect(detail.availableBoards).toEqual([])
  })

  it('líder com team.link delegado vê as opções de vínculo da própria equipe', async () => {
    const x = await linkedTeam()
    await setCapabilityFor(admin, 'LEADER', 'team.link', true)
    try {
      const detail = await teamDetailFor(await ctxFor(x.leader.userId), x.team.id)

      expect(detail.availablePipelines.map((p) => p.id)).toContain(x.free.id)
    } finally {
      await setCapabilityFor(admin, 'LEADER', 'team.link', false)
    }
  })

  it('equipe sem vínculo mostra a meta e a pontuação padrão do tenant', async () => {
    const team = await addTeam(f, uniqueName('Sem vínculo'))

    const detail = await teamDetailFor(admin, team.id)

    expect(detail.goal).toMatchObject({ id: f.goal.id, name: f.goal.name, targetPoints: f.goal.targetPoints, activeDays: f.goal.activeDays, isDefault: true })
    expect(detail.scoringRule).toMatchObject({ id: f.scoringRule.id, name: f.scoringRule.name, isDefault: true })
  })

  it('equipe vinculada mostra a meta e a pontuação próprias, inclusive para um membro', async () => {
    const team = await addTeam(f, uniqueName('Com vínculo'))
    const member = await addUser(f, { role: 'MEMBER', team })
    const goal = await createGoalFor(admin, { name: uniqueName('Meta'), targetPoints: 300, activeDays: [1, 3] })
    const rule = await createScoringRuleFor(admin, { name: uniqueName('Pontuação'), rules: { ...FACTORY_RULES, floorPct: 60 } })
    await setGoalTeamsFor(admin, goal.id, [team.id])
    await setScoringRuleTeamsFor(admin, rule.id, [team.id])

    const detail = await teamDetailFor(member, team.id)

    expect(detail.goal).toMatchObject({ id: goal.id, name: goal.name, targetPoints: 300, activeDays: [1, 3], isDefault: false })
    expect(detail.scoringRule).toMatchObject({ id: rule.id, name: rule.name, isDefault: false })
  })

  it('quem não integra a equipe e a equipe de outro tenant são "não encontradas"', async () => {
    const x = await linkedTeam()
    const outsider = await addUser(f, { role: 'MEMBER', team: f.team })

    await expect(teamDetailFor(outsider, x.team.id)).rejects.toThrow('Equipe não encontrada')
    await expect(teamDetailFor(otherAdmin, x.team.id)).rejects.toThrow('Equipe não encontrada')
  })
})
