import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { authMiddleware } from './auth-context'
import { addNoteFor, listNotesFor } from './notes.core'

const target = z.object({ type: z.enum(['task', 'lead', 'opportunity']), id: z.uuid() })

export const listNotes = createServerFn()
  .middleware([authMiddleware])
  .validator(target)
  .handler(({ data, context: { auth: me } }) => listNotesFor(me, data))

export const addNote = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ target, body: z.string() }))
  .handler(async ({ data, context: { auth: me } }) => {
    await addNoteFor(me, data.target, data.body)
  })
