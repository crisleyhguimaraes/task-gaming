import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { createAuthMiddleware, getSessionFromCtx, isAPIError } from 'better-auth/api'
import { admin } from 'better-auth/plugins'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { and, eq, ne } from 'drizzle-orm'
import { db } from '#/db'
import { accounts, sessions, users, verifications } from '#/db/schema'
import { recordImpersonationStopped, recordLoginFailed, recordSessionStarted } from '#/server/auth-events.core'
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
      tenantId: { type: 'string', required: true, input: false },
      teamId: { type: 'string', required: false, input: false },
      mustChangePassword: { type: 'boolean', required: false, input: false },
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
          await recordSessionStarted(s)
        },
      },
    },
  },
  hooks: {
    // Ainda com a sessão impersonada de pé: depois do endpoint ela já foi apagada.
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== '/admin/stop-impersonating') return
      const current = await getSessionFromCtx(ctx)
      if (current) await recordImpersonationStopped(current.session)
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== '/sign-in/email' || !isAPIError(ctx.context.returned)) return
      await recordLoginFailed(String(ctx.body?.email ?? ''))
    }),
  },
  plugins: [admin({ ac, roles, adminRoles: ['SUPER_ADMIN'], defaultRole: 'MEMBER' }), tanstackStartCookies()],
})

export type Session = typeof auth.$Infer.Session
