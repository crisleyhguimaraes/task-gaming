import type { db } from '#/db'

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Aceita `db` ou `tx`: para quem só lê. */
export type Reader = Pick<typeof db, 'select'>
