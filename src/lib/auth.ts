import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { createAuthMiddleware, getSessionFromCtx, isAPIError } from 'better-auth/api'
import { admin, twoFactor } from 'better-auth/plugins'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { and, eq, ne } from 'drizzle-orm'
import { db } from '#/db'
import { accounts, sessions, twoFactors, users, verifications } from '#/db/schema'
import {
  completePasswordReset,
  opensLoginSession,
  recordImpersonationStopped,
  recordLoginFailed,
  recordSessionStarted,
  recordTwoFactorChanged,
} from '#/server/auth-events.core'
import { sendMail } from '#/server/mail'
import { ac, roles } from './permissions'

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: { user: users, session: sessions, account: accounts, verification: verifications, twoFactor: twoFactors },
  }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 8,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: ({ user, url }) =>
      sendMail(
        user.email,
        'Redefinição de senha',
        `<p>Recebemos um pedido para redefinir sua senha no Task Gaming.</p><p><a href="${url}">Escolher nova senha</a> (válido por 1 hora). Se não foi você, ignore este email.</p>`,
      ),
    onPasswordReset: ({ user }) => completePasswordReset(user.id),
  },
  // Sem await, o tempo da resposta não revela se o email existe (o envio só acontece quando existe).
  advanced: { backgroundTasks: { handler: (task) => void task.catch((e) => console.error('[auth] tarefa em segundo plano falhou', e)) } },
  // NOTE: contagem em memória vale para uma só instância; storage: 'database' se escalar.
  rateLimit: {
    enabled: true,
    customRules: {
      '/sign-in/email': { window: 60, max: 5 },
      '/request-password-reset': { window: 10 * 60, max: 3 },
    },
  },
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
        // NOTE: impersonar alguém também derruba a sessão real dele — aceito.
        after: async (s, ctx) => {
          const hadSession = ctx?.path.startsWith('/two-factor/') ? Boolean(await getSessionFromCtx(ctx)) : false
          if (!(await opensLoginSession(s.userId, ctx?.path, hadSession))) return
          await db
            .delete(sessions)
            .where(and(eq(sessions.userId, s.userId), ne(sessions.id, s.id)))
          await recordSessionStarted(s)
        },
      },
    },
    user: { update: { after: async (u, ctx) => recordTwoFactorChanged(ctx?.path, u.id) } },
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
  plugins: [admin({ ac, roles, adminRoles: ['SUPER_ADMIN'], defaultRole: 'MEMBER' }), twoFactor({ issuer: 'Task Gaming' }), tanstackStartCookies()],
})

export type Session = typeof auth.$Infer.Session
