import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin } from 'better-auth/plugins'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { and, eq, ne } from 'drizzle-orm'
import { db } from '#/db'
import { accounts, sessions, users, verifications } from '#/db/schema'
import { ac, roles } from './permissions'

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: { user: users, session: sessions, account: accounts, verification: verifications },
  }),
  emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 8 },
  session: { expiresIn: 60 * 60 * 10, updateAge: 60 * 60 },
  user: {
    additionalFields: {
      tenantId: { type: 'string', required: true },
      teamId: { type: 'string', required: false },
      mustChangePassword: { type: 'boolean', required: false },
    },
  },
  databaseHooks: {
    session: {
      create: {
        // Login novo derruba as outras sessões do usuário.
        // ponytail: impersonar alguém também derruba a sessão real dele — aceito.
        after: async (s) => {
          await db
            .delete(sessions)
            .where(and(eq(sessions.userId, s.userId), ne(sessions.id, s.id)))
        },
      },
    },
  },
  plugins: [admin({ ac, roles, adminRoles: ['SUPER_ADMIN'], defaultRole: 'MEMBER' }), tanstackStartCookies()],
})

export type Session = typeof auth.$Infer.Session
