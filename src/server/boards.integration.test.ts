import { and, asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import type { TaskStatus } from '#/db/schema'
import { auditEvents, boardTeams, boards, tasks } from '#/db/schema'
import { archiveBoardFor, createBoardFor, linkTeamToBoardFor, listBoardsFor, renameBoardFor, restoreBoardFor, unlinkTeamFromBoardFor } from './boards.core'
import { setCapabilityFor } from './permissions.core'
import type { AuthCtx } from './roles'
import { addAdmin, addTeam, addUser, ctxFor, joinTeam, makeTenant } from './test-fixtures'

type Fixture = Awaited<ReturnType<typeof makeTenant>>

let f: Fixture
let other: Fixture
let admin: AuthCtx
let otherAdmin: AuthCtx
let teamB: { id: string }
let leaderB: AuthCtx

const auditFor = (entityId: string) =>
  db.select().from(auditEvents).where(and(eq(auditEvents.tenantId, f.tenant.id), eq(auditEvents.entityId, entityId))).orderBy(asc(auditEvents.createdAt), asc(auditEvents.id))

const actionsFor = async (entityId: string) => (await auditFor(entityId)).map((e) => e.action)

const reload = async (id: string) => (await db.select().from(boards).where(eq(boards.id, id)))[0]!

const linksOf = (boardId: string) => db.select().from(boardTeams).where(eq(boardTeams.boardId, boardId))

let sequence = 0
const uniqueName = (label: string) => `${label} ${++sequence}`

async function boardFor(teamIds: Array<string>, label = 'Quadro') {
  return createBoardFor(admin, { name: uniqueName(label), teamIds })
}

function insertTask(boardId: string, teamId: string, status: TaskStatus = 'pending') {
  return db.insert(tasks).values({ tenantId: f.tenant.id, teamId, boardId, title: 'Tarefa', basePoints: 10, estimatedSeconds: 600, status })
}

beforeAll(async () => {
  f = await makeTenant(2)
  other = await makeTenant(0)
  admin = await addAdmin(f)
  otherAdmin = await addAdmin(other)
  teamB = await addTeam(f, 'Equipe B')
  leaderB = await addUser(f, { role: 'MEMBER', team: teamB, teamRole: 'LEADER' })
})
afterAll(async () => {
  await f.cleanup()
  await other.cleanup()
  await db.$client.end()
})

describe('createBoardFor', () => {
  it('cria já vinculado às equipes, com nome aparado, e audita criação e vínculos', async () => {
    const created = await createBoardFor(admin, { name: '  Campanha de maio ', teamIds: [f.team.id, teamB.id] })

    expect(created).toMatchObject({ name: 'Campanha de maio', archivedAt: null, tenantId: f.tenant.id })
    expect((await linksOf(created.id)).map((l) => l.teamId).sort()).toEqual([f.team.id, teamB.id].sort())
    expect((await actionsFor(created.id)).sort()).toEqual(['board.created', 'board.team_linked', 'board.team_linked'])
  })

  it('admin cria board sem vínculo e a mesma equipe repetida vale uma vez', async () => {
    const free = await boardFor([])
    const repeated = await boardFor([f.team.id, f.team.id])

    expect(await linksOf(free.id)).toHaveLength(0)
    expect(await linksOf(repeated.id)).toHaveLength(1)
  })

  it('líder cria vinculado à equipe que lidera', async () => {
    const created = await createBoardFor(f.leader, { name: uniqueName('Do líder'), teamIds: [f.team.id] })

    expect((await linksOf(created.id)).map((l) => l.teamId)).toEqual([f.team.id])
  })

  it('líder não cria sem vínculo nem vinculado a equipe que não lidera; membro não cria', async () => {
    await expect(createBoardFor(f.leader, { name: uniqueName('Sem vínculo'), teamIds: [] })).rejects.toThrow('Sem permissão')
    await expect(createBoardFor(f.leader, { name: uniqueName('Alheio'), teamIds: [teamB.id] })).rejects.toThrow('Sem permissão')
    await expect(createBoardFor(f.leader, { name: uniqueName('Misto'), teamIds: [f.team.id, teamB.id] })).rejects.toThrow('Sem permissão')
    await expect(createBoardFor(f.members[0]!, { name: uniqueName('Membro'), teamIds: [f.team.id] })).rejects.toThrow('Sem permissão')
  })

  it('o ajuste do tenant que tira board.manage do líder vale', async () => {
    await setCapabilityFor(admin, 'LEADER', 'board.manage', false)
    try {
      await expect(createBoardFor(await ctxFor(f.leader.userId), { name: uniqueName('Sem direito'), teamIds: [f.team.id] })).rejects.toThrow('Sem permissão')
    } finally {
      await setCapabilityFor(admin, 'LEADER', 'board.manage', true)
    }
  })

  it('recusa nome curto ou longo demais', async () => {
    await expect(createBoardFor(admin, { name: ' a ', teamIds: [] })).rejects.toThrow('nome')
    await expect(createBoardFor(admin, { name: 'x'.repeat(81), teamIds: [] })).rejects.toThrow('nome')
  })

  it('recusa nome repetido sem diferenciar maiúsculas, mas aceita o mesmo nome em outro tenant', async () => {
    const name = uniqueName('Roadmap')
    await createBoardFor(admin, { name, teamIds: [] })

    await expect(createBoardFor(admin, { name: `  ${name.toUpperCase()} `, teamIds: [] })).rejects.toThrow('Já existe um board com esse nome')
    await expect(createBoardFor(otherAdmin, { name, teamIds: [] })).resolves.toMatchObject({ name })
  })

  it('equipe de outro tenant é "não encontrada" e nenhum board sobra', async () => {
    const name = uniqueName('Invasor')

    await expect(createBoardFor(admin, { name, teamIds: [f.team.id, other.team.id] })).rejects.toThrow('Equipe não encontrada')
    expect(await db.select().from(boards).where(and(eq(boards.tenantId, f.tenant.id), eq(boards.name, name)))).toHaveLength(0)
  })

  it('dois pedidos simultâneos com o mesmo nome: um vence e o outro recebe a mensagem', async () => {
    const name = uniqueName('Disputa')

    const results = await Promise.allSettled([createBoardFor(admin, { name, teamIds: [f.team.id] }), createBoardFor(admin, { name, teamIds: [f.team.id] })])

    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(String(rejected[0]!.reason)).toContain('Já existe um board com esse nome')
    expect(await db.select().from(boards).where(and(eq(boards.tenantId, f.tenant.id), eq(boards.name, name)))).toHaveLength(1)
  })
})

describe('renameBoardFor', () => {
  it('renomeia com trim e registra o diff', async () => {
    const created = await boardFor([f.team.id], 'Antigo')

    const renamed = await renameBoardFor(admin, created.id, '  Novo nome ')

    expect(renamed.name).toBe('Novo nome')
    expect((await auditFor(created.id)).at(-1)).toMatchObject({ action: 'board.updated', changes: { name: { from: created.name, to: 'Novo nome' } } })
  })

  it('não grava evento quando o nome não muda', async () => {
    const created = await boardFor([], 'Igual')

    await renameBoardFor(admin, created.id, ` ${created.name} `)

    expect(await actionsFor(created.id)).toEqual(['board.created'])
  })

  it('recusa nome de outro board ativo, mas libera o nome de um arquivado', async () => {
    const taken = await boardFor([], 'Ocupado')
    const archived = await boardFor([], 'Arquivado')
    await archiveBoardFor(admin, archived.id)
    const mine = await boardFor([], 'Meu')

    await expect(renameBoardFor(admin, mine.id, taken.name.toUpperCase())).rejects.toThrow('Já existe um board com esse nome')
    await expect(renameBoardFor(admin, mine.id, archived.name)).resolves.toMatchObject({ name: archived.name })
  })

  it('líder renomeia o board só das equipes dele; compartilhado ou sem vínculo, não', async () => {
    const own = await boardFor([f.team.id], 'Do líder')
    const shared = await boardFor([f.team.id, teamB.id], 'Compartilhado')
    const unlinked = await boardFor([], 'Solto')

    await expect(renameBoardFor(f.leader, own.id, 'Renomeado pelo líder')).resolves.toMatchObject({ name: 'Renomeado pelo líder' })
    await expect(renameBoardFor(f.leader, shared.id, 'Invadido')).rejects.toThrow('Sem permissão')
    await expect(renameBoardFor(f.leader, unlinked.id, 'Invadido')).rejects.toThrow('Sem permissão')
    await expect(renameBoardFor(f.members[0]!, own.id, 'Invadido')).rejects.toThrow('Sem permissão')
  })

  it('board de outro tenant é "não encontrado"', async () => {
    const created = await boardFor([], 'Protegido')

    await expect(renameBoardFor(otherAdmin, created.id, 'Invadido')).rejects.toThrow('Board não encontrado')
    expect((await reload(created.id)).name).toBe(created.name)
  })
})

describe('archiveBoardFor e restoreBoardFor', () => {
  it('arquiva board sem tarefa viva, audita, e restaura', async () => {
    const created = await boardFor([f.team.id], 'Velho')

    await archiveBoardFor(admin, created.id)
    expect((await reload(created.id)).archivedAt).toBeInstanceOf(Date)
    await restoreBoardFor(admin, created.id)

    expect((await reload(created.id)).archivedAt).toBeNull()
    expect((await actionsFor(created.id)).slice(2)).toEqual(['board.archived', 'board.restored'])
  })

  it('recusa arquivar com tarefa pendente, em andamento ou pausada, citando a contagem', async () => {
    const created = await boardFor([f.team.id], 'Vivo')
    await insertTask(created.id, f.team.id, 'pending')
    await insertTask(created.id, f.team.id, 'in_progress')
    await insertTask(created.id, teamB.id, 'paused')

    await expect(archiveBoardFor(admin, created.id)).rejects.toThrow('3 tarefas')
    expect((await reload(created.id)).archivedAt).toBeNull()
  })

  it('arquiva board que só tem histórico (concluídas e canceladas)', async () => {
    const created = await boardFor([f.team.id], 'Histórico')
    await insertTask(created.id, f.team.id, 'finished')
    await insertTask(created.id, f.team.id, 'cancelled')

    await archiveBoardFor(admin, created.id)

    expect((await reload(created.id)).archivedAt).toBeInstanceOf(Date)
  })

  it('recusa arquivar duas vezes e restaurar quem não está arquivado', async () => {
    const created = await boardFor([], 'Duas vezes')

    await expect(restoreBoardFor(admin, created.id)).rejects.toThrow('não está arquivado')
    await archiveBoardFor(admin, created.id)
    await expect(archiveBoardFor(admin, created.id)).rejects.toThrow('já está arquivado')
  })

  it('recusa restaurar quando outro board ativo ficou com o nome', async () => {
    const created = await boardFor([], 'Nome disputado')
    await archiveBoardFor(admin, created.id)
    await createBoardFor(admin, { name: created.name, teamIds: [] })

    await expect(restoreBoardFor(admin, created.id)).rejects.toThrow('Já existe um board com esse nome')
  })

  it('líder arquiva e restaura o board das equipes dele; o compartilhado é do admin', async () => {
    const own = await boardFor([f.team.id], 'Líder arquiva')
    const shared = await boardFor([f.team.id, teamB.id], 'Líder não arquiva')

    await archiveBoardFor(f.leader, own.id)
    await restoreBoardFor(f.leader, own.id)

    await expect(archiveBoardFor(f.leader, shared.id)).rejects.toThrow('Sem permissão')
    await expect(archiveBoardFor(otherAdmin, own.id)).rejects.toThrow('Board não encontrado')
  })
})

describe('linkTeamToBoardFor e unlinkTeamFromBoardFor', () => {
  it('admin vincula, repetir não duplica nem audita de novo, e desvincula', async () => {
    const created = await boardFor([], 'Vínculo')

    await linkTeamToBoardFor(admin, created.id, f.team.id)
    await linkTeamToBoardFor(admin, created.id, f.team.id)
    expect(await linksOf(created.id)).toHaveLength(1)
    await unlinkTeamFromBoardFor(admin, created.id, f.team.id)

    expect(await linksOf(created.id)).toHaveLength(0)
    expect(await actionsFor(created.id)).toEqual(['board.created', 'board.team_linked', 'board.team_unlinked'])
    expect((await auditFor(created.id)).at(-1)).toMatchObject({ meta: { teamId: f.team.id, name: created.name } })
  })

  it('recusa vincular board arquivado', async () => {
    const created = await boardFor([], 'Arquivado sem vínculo')
    await archiveBoardFor(admin, created.id)

    await expect(linkTeamToBoardFor(admin, created.id, f.team.id)).rejects.toThrow('Board arquivado')
  })

  it('recusa desvincular a equipe que tem tarefa viva no board, mantendo o vínculo', async () => {
    const created = await boardFor([f.team.id, teamB.id], 'Com tarefa')
    await insertTask(created.id, f.team.id, 'in_progress')
    await insertTask(created.id, f.team.id, 'pending')

    await expect(unlinkTeamFromBoardFor(admin, created.id, f.team.id)).rejects.toThrow('2 tarefas')
    expect(await linksOf(created.id)).toHaveLength(2)
    await expect(unlinkTeamFromBoardFor(admin, created.id, teamB.id)).resolves.toBeUndefined()
  })

  it('desvincula equipe que só tem histórico no board', async () => {
    const created = await boardFor([f.team.id], 'Só histórico')
    await insertTask(created.id, f.team.id, 'finished')

    await unlinkTeamFromBoardFor(admin, created.id, f.team.id)

    expect(await linksOf(created.id)).toHaveLength(0)
  })

  it('exige team.link na equipe: líder só com a delegação e só na própria equipe', async () => {
    const created = await boardFor([f.team.id], 'Delegado')
    await expect(linkTeamToBoardFor(f.leader, created.id, f.team.id)).rejects.toThrow('Sem permissão')
    await setCapabilityFor(admin, 'LEADER', 'team.link', true)
    try {
      const leader = await ctxFor(f.leader.userId)

      await expect(linkTeamToBoardFor(leader, created.id, teamB.id)).rejects.toThrow('Sem permissão')
      await expect(linkTeamToBoardFor(await ctxFor(f.members[0]!.userId), created.id, f.team.id)).rejects.toThrow('Sem permissão')
    } finally {
      await setCapabilityFor(admin, 'LEADER', 'team.link', false)
    }
  })

  describe('líder com team.link só vincula a board que já gerencia', () => {
    let teamC: { id: string }
    let leader: AuthCtx

    beforeAll(async () => {
      teamC = await addTeam(f, 'Equipe C')
      await joinTeam(f, f.leader.userId, teamC, 'LEADER')
      await setCapabilityFor(admin, 'LEADER', 'team.link', true)
      leader = await ctxFor(f.leader.userId)
    })
    afterAll(() => setCapabilityFor(admin, 'LEADER', 'team.link', false))

    it('vincula outra equipe que também lidera a um board só das equipes dele', async () => {
      const board = await boardFor([f.team.id], 'Só meu')

      await linkTeamToBoardFor(leader, board.id, teamC.id)

      expect((await linksOf(board.id)).map((l) => l.teamId).sort()).toEqual([f.team.id, teamC.id].sort())
    })

    it('não entra no board de outra equipe: o líder dela perderia o controle', async () => {
      const board = await boardFor([teamB.id], 'Da equipe B')

      await expect(linkTeamToBoardFor(leader, board.id, f.team.id)).rejects.toThrow('Sem permissão')

      expect(await linksOf(board.id)).toHaveLength(1)
      await expect(renameBoardFor(leaderB, board.id, uniqueName('Renomeado pelo dono'))).resolves.not.toThrow()
    })

    it('não entra em board sem vínculo, que é só do admin', async () => {
      const board = await boardFor([], 'Sem vínculo')

      await expect(linkTeamToBoardFor(leader, board.id, f.team.id)).rejects.toThrow('Sem permissão')

      expect(await linksOf(board.id)).toHaveLength(0)
    })

    it('não amplia um board compartilhado com equipe que ele não lidera', async () => {
      const board = await boardFor([f.team.id, teamB.id], 'Compartilhado')

      await expect(linkTeamToBoardFor(leader, board.id, teamC.id)).rejects.toThrow('Sem permissão')
    })

    it('o admin vincula em qualquer board', async () => {
      const board = await boardFor([teamB.id], 'Admin vincula')

      await linkTeamToBoardFor(admin, board.id, f.team.id)

      expect(await linksOf(board.id)).toHaveLength(2)
    })
  })

  it('recusa board ou equipe de outro tenant', async () => {
    const mine = await boardFor([], 'Meu vínculo')
    const theirs = await createBoardFor(otherAdmin, { name: uniqueName('Board deles'), teamIds: [] })

    await expect(linkTeamToBoardFor(admin, theirs.id, f.team.id)).rejects.toThrow('Board não encontrado')
    await expect(linkTeamToBoardFor(admin, mine.id, other.team.id)).rejects.toThrow('Equipe não encontrada')
    expect(await linksOf(mine.id)).toHaveLength(0)
  })
})

describe('listBoardsFor', () => {
  it('admin vê todos, inclusive arquivados e sem vínculo, com as equipes de cada um', async () => {
    const shared = await boardFor([f.team.id, teamB.id], 'Lista compartilhada')
    const free = await boardFor([], 'Lista solta')
    const archived = await boardFor([f.team.id], 'Lista arquivada')
    await archiveBoardFor(admin, archived.id)

    const list = await listBoardsFor(admin)

    expect(list.find((b) => b.id === shared.id)!.teams.map((t) => t.id).sort()).toEqual([f.team.id, teamB.id].sort())
    expect(list.find((b) => b.id === free.id)).toMatchObject({ teams: [], canManage: true })
    expect(list.find((b) => b.id === archived.id)!.archivedAt).toBeInstanceOf(Date)
  })

  it('os demais veem só os boards vinculados às equipes que integram; o sem vínculo é só do admin', async () => {
    const onlyB = await boardFor([teamB.id], 'Só da B')
    const onlyA = await boardFor([f.team.id], 'Só da A')
    const free = await boardFor([], 'Ninguém')
    const member = f.members[0]!

    const memberIds = (await listBoardsFor(member)).map((b) => b.id)

    expect(memberIds).toContain(onlyA.id)
    expect(memberIds).not.toContain(onlyB.id)
    expect(memberIds).not.toContain(free.id)
  })

  it('quem integra duas equipes vê os boards das duas, sem repetir o compartilhado', async () => {
    const both = await joinTeam(f, (await addUser(f, { role: 'MEMBER', team: f.team })).userId, teamB)
    const shared = await boardFor([f.team.id, teamB.id], 'Duas equipes')
    const onlyB = await boardFor([teamB.id], 'Só B de novo')

    const ids = (await listBoardsFor(both)).map((b) => b.id)

    expect(ids.filter((id) => id === shared.id)).toHaveLength(1)
    expect(ids).toContain(onlyB.id)
  })

  it('canManage segue a regra do líder: o próprio sim, o compartilhado não', async () => {
    const own = await boardFor([f.team.id], 'Gerenciável')
    const shared = await boardFor([f.team.id, teamB.id], 'Não gerenciável')

    const list = await listBoardsFor(f.leader)

    expect(list.find((b) => b.id === own.id)!.canManage).toBe(true)
    expect(list.find((b) => b.id === shared.id)!.canManage).toBe(false)
    expect((await listBoardsFor(leaderB)).find((b) => b.id === shared.id)!.canManage).toBe(false)
  })

  it('não mostra board de outro tenant', async () => {
    const theirs = await createBoardFor(otherAdmin, { name: uniqueName('Deles'), teamIds: [other.team.id] })

    expect((await listBoardsFor(admin)).some((b) => b.id === theirs.id)).toBe(false)
  })
})
