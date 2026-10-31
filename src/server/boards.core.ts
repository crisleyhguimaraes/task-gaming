import { and, asc, count, eq, inArray } from 'drizzle-orm'
import { db } from '#/db'
import { boardTeams, boards, tasks, teams } from '#/db/schema'
import { diffFields } from '#/lib/audit'
import { canManageBoard, countTasks } from '#/lib/boards'
import { recordAudit } from './audit.core'
import { failOnDuplicate } from './duplicate'
import type { AuthCtx } from './roles'
import { canManageWith, fail, forbid, requireCan } from './roles'
import { teamIdsOf } from './scope'
import { inOpen } from './stats'
import { assertTeamInTenant } from './teams.core'
import type { Reader, Tx } from './tx'
import { assertValidName } from './validation'

const DUPLICATE_NAME = 'Já existe um board com esse nome'
const NOT_LINKED = 'O board não está vinculado à equipe da tarefa'

const boardEntity = (boardId: string) => ({ entityType: 'board', entityId: boardId })

/** Sempre filtra por tenant: o id vem do cliente. `lock` trava a linha até o fim da transação. */
async function loadBoard(tx: Tx, me: AuthCtx, boardId: string, lock?: 'update' | 'share') {
  const query = tx.select().from(boards).where(and(eq(boards.id, boardId), eq(boards.tenantId, me.tenantId)))
  const [board] = await (lock ? query.for(lock) : query)
  if (!board) fail('Board não encontrado')
  return board
}

async function linkedTeamIdsOf(tx: Reader, boardId: string) {
  const links = await tx.select({ teamId: boardTeams.teamId }).from(boardTeams).where(eq(boardTeams.boardId, boardId))
  return links.map((l) => l.teamId)
}

/** Trava o board e confere se `me` pode geri-lo, pelas equipes vinculadas. */
async function loadManagedBoard(tx: Tx, me: AuthCtx, boardId: string) {
  const board = await loadBoard(tx, me, boardId, 'update')
  if (!canManageBoard(me, await linkedTeamIdsOf(tx, boardId))) forbid()
  return board
}

async function liveTasksOn(tx: Reader, boardId: string, teamId?: string) {
  const [row] = await tx
    .select({ n: count() })
    .from(tasks)
    .where(and(eq(tasks.boardId, boardId), inOpen(), teamId ? eq(tasks.teamId, teamId) : undefined))
  return row!.n
}

/** FOR SHARE espera o arquivamento em curso (e vice-versa): ninguém cria tarefa num board que está sendo arquivado. */
async function lockOpenBoard(tx: Tx, me: AuthCtx, boardId: string) {
  const board = await loadBoard(tx, me, boardId, 'share')
  if (board.archivedAt) fail('Board arquivado')
  return board
}

/**
 * Confere e trava o board e o vínculo da equipe para uma tarefa nova: desvincular e arquivar esperam esta transação
 * e, depois dela, enxergam a tarefa.
 */
export async function lockBoardForTask(tx: Tx, me: AuthCtx, boardId: string, teamId: string) {
  await lockOpenBoard(tx, me, boardId)
  const [link] = await tx
    .select({ teamId: boardTeams.teamId })
    .from(boardTeams)
    .where(and(eq(boardTeams.boardId, boardId), eq(boardTeams.teamId, teamId)))
    .for('share')
  if (!link) fail(NOT_LINKED)
}

async function linkTeams(tx: Tx, me: AuthCtx, board: { id: string; name: string }, teamIds: ReadonlyArray<string>) {
  for (const teamId of teamIds) {
    await tx.insert(boardTeams).values({ boardId: board.id, teamId, tenantId: me.tenantId })
    await recordAudit(tx, me, { action: 'board.team_linked', ...boardEntity(board.id), meta: { teamId, name: board.name } })
  }
}

/** Admin cria com ou sem vínculo; líder, só vinculado a equipes que ele lidera e pode vincular (team.link), as mesmas que poderá desvincular depois. */
export async function createBoardFor(me: AuthCtx, { name, teamIds }: { name: string; teamIds: ReadonlyArray<string> }) {
  requireCan(me, 'board.manage')
  assertValidName(name, 'do board')
  const uniqueTeamIds = [...new Set(teamIds)]
  if (!canManageBoard(me, uniqueTeamIds) || !uniqueTeamIds.every((teamId) => canManageWith(me, 'team.link', teamId))) forbid()
  return db.transaction(async (tx) => {
    for (const teamId of uniqueTeamIds) await assertTeamInTenant(tx, me.tenantId, teamId)
    const [board] = await failOnDuplicate(DUPLICATE_NAME, tx.insert(boards).values({ tenantId: me.tenantId, name: name.trim() }).returning())
    await recordAudit(tx, me, { action: 'board.created', ...boardEntity(board!.id), meta: { name: board!.name } })
    await linkTeams(tx, me, board!, uniqueTeamIds)
    return board!
  })
}

export async function renameBoardFor(me: AuthCtx, boardId: string, name: string) {
  requireCan(me, 'board.manage')
  assertValidName(name, 'do board')
  return db.transaction(async (tx) => {
    const board = await loadManagedBoard(tx, me, boardId)
    const [renamed] = await failOnDuplicate(DUPLICATE_NAME, tx.update(boards).set({ name: name.trim() }).where(eq(boards.id, board.id)).returning())
    const changes = diffFields(board, renamed!, ['name'])
    if (Object.keys(changes).length) await recordAudit(tx, me, { action: 'board.updated', ...boardEntity(board.id), changes })
    return renamed!
  })
}

export async function archiveBoardFor(me: AuthCtx, boardId: string, now = new Date()) {
  requireCan(me, 'board.manage')
  await db.transaction(async (tx) => {
    const board = await loadManagedBoard(tx, me, boardId)
    if (board.archivedAt) fail('O board já está arquivado')
    const live = await liveTasksOn(tx, board.id)
    if (live > 0) fail(`O board tem ${countTasks(live)} em aberto; conclua, cancele ou mova antes de arquivar`)
    await tx.update(boards).set({ archivedAt: now }).where(eq(boards.id, board.id))
    await recordAudit(tx, me, { action: 'board.archived', ...boardEntity(board.id), meta: { name: board.name } })
  })
}

export async function restoreBoardFor(me: AuthCtx, boardId: string) {
  requireCan(me, 'board.manage')
  await db.transaction(async (tx) => {
    const board = await loadManagedBoard(tx, me, boardId)
    if (!board.archivedAt) fail('O board não está arquivado')
    await failOnDuplicate(DUPLICATE_NAME, tx.update(boards).set({ archivedAt: null }).where(eq(boards.id, board.id)))
    await recordAudit(tx, me, { action: 'board.restored', ...boardEntity(board.id), meta: { name: board.name } })
  })
}

export async function linkTeamToBoardFor(me: AuthCtx, boardId: string, teamId: string) {
  requireCan(me, 'team.link', teamId)
  await db.transaction(async (tx) => {
    const board = await lockOpenBoard(tx, me, boardId)
    // Entrar num board alheio tiraria do líder dele o poder de geri-lo: canManageBoard exige que todas as equipes vinculadas sejam suas.
    if (!canManageBoard(me, await linkedTeamIdsOf(tx, board.id))) forbid()
    await assertTeamInTenant(tx, me.tenantId, teamId)
    const linked = await tx.insert(boardTeams).values({ boardId: board.id, teamId, tenantId: me.tenantId }).onConflictDoNothing().returning()
    if (!linked.length) return
    await recordAudit(tx, me, { action: 'board.team_linked', ...boardEntity(board.id), meta: { teamId, name: board.name } })
  })
}

/** Apaga o vínculo antes de contar: quem criou tarefa segurando o vínculo já terminou, e a contagem a enxerga. */
export async function unlinkTeamFromBoardFor(me: AuthCtx, boardId: string, teamId: string) {
  requireCan(me, 'team.link', teamId)
  await db.transaction(async (tx) => {
    const board = await loadBoard(tx, me, boardId)
    const removed = await tx
      .delete(boardTeams)
      .where(and(eq(boardTeams.boardId, board.id), eq(boardTeams.teamId, teamId), eq(boardTeams.tenantId, me.tenantId)))
      .returning()
    if (!removed.length) return
    const live = await liveTasksOn(tx, board.id, teamId)
    if (live > 0) fail(`A equipe tem ${countTasks(live)} em aberto neste board; conclua, cancele ou mova antes de desvincular`)
    await recordAudit(tx, me, { action: 'board.team_unlinked', ...boardEntity(board.id), meta: { teamId, name: board.name } })
  })
}

/** Admin vê todos (inclusive arquivados e sem vínculo); os demais, os vinculados às equipes que integram. */
export async function listBoardsFor(me: AuthCtx) {
  const teamIds = teamIdsOf(me)
  if (teamIds !== 'all' && !teamIds.length) return []
  const visible = teamIds === 'all' ? undefined : inArray(boards.id, db.select({ id: boardTeams.boardId }).from(boardTeams).where(inArray(boardTeams.teamId, [...teamIds])))
  const rows = await db
    .select({ id: boards.id, name: boards.name, archivedAt: boards.archivedAt })
    .from(boards)
    .where(and(eq(boards.tenantId, me.tenantId), visible))
    .orderBy(asc(boards.name))
  const links = rows.length
    ? await db
        .select({ boardId: boardTeams.boardId, id: teams.id, name: teams.name })
        .from(boardTeams)
        .innerJoin(teams, eq(teams.id, boardTeams.teamId))
        .where(inArray(boardTeams.boardId, rows.map((b) => b.id)))
        .orderBy(asc(teams.name))
    : []
  return rows.map((board) => {
    const linked = links.filter((l) => l.boardId === board.id)
    return { ...board, teams: linked.map(({ id, name }) => ({ id, name })), canManage: canManageBoard(me, linked.map((l) => l.id)) }
  })
}
