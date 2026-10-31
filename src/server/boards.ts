import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { archiveBoardFor, createBoardFor, linkTeamToBoardFor, listBoardsFor, renameBoardFor, restoreBoardFor, unlinkTeamFromBoardFor } from './boards.core'
import { authMiddleware } from './auth-context'

const boardName = z.string().trim().min(2).max(80)
const boardId = z.object({ boardId: z.uuid() })
const teamLink = z.object({ boardId: z.uuid(), teamId: z.uuid() })

export const listBoards = createServerFn()
  .middleware([authMiddleware])
  .handler(({ context: { auth: me } }) => listBoardsFor(me))

export const createBoard = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ name: boardName, teamIds: z.array(z.uuid()).max(100) }))
  .handler(async ({ data, context: { auth: me } }) => {
    const board = await createBoardFor(me, data)
    return { id: board.id }
  })

export const renameBoard = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ boardId: z.uuid(), name: boardName }))
  .handler(async ({ data, context: { auth: me } }) => {
    await renameBoardFor(me, data.boardId, data.name)
  })

export const archiveBoard = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(boardId)
  .handler(({ data, context: { auth: me } }) => archiveBoardFor(me, data.boardId))

export const restoreBoard = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(boardId)
  .handler(({ data, context: { auth: me } }) => restoreBoardFor(me, data.boardId))

export const linkTeamToBoard = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(teamLink)
  .handler(({ data, context: { auth: me } }) => linkTeamToBoardFor(me, data.boardId, data.teamId))

export const unlinkTeamFromBoard = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(teamLink)
  .handler(({ data, context: { auth: me } }) => unlinkTeamFromBoardFor(me, data.boardId, data.teamId))
