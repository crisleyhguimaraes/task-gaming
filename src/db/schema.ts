import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

export const roleEnum = pgEnum('role', [
  'SUPER_ADMIN',
  'TENANT_ADMIN',
  'TEAM_LEADER',
  'MEMBER',
])
export type Role = (typeof roleEnum.enumValues)[number]

const ts = (name: string) => timestamp(name, { withTimezone: true })

export const tenants = pgTable('tenants', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 120 }).notNull(),
  slug: varchar('slug', { length: 60 }).notNull().unique(),
  timezone: varchar('timezone', { length: 64 })
    .notNull()
    .default('America/Sao_Paulo'),
  dailyGoalPoints: integer('daily_goal_points').notNull().default(100),
  createdAt: ts('created_at').defaultNow().notNull(),
})

export const teams = pgTable(
  'teams',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    createdAt: ts('created_at').defaultNow().notNull(),
  },
  (t) => [index('teams_tenant_idx').on(t.tenantId)],
)

// Better Auth `user` (+ plugin admin) + nossos campos de tenant.
export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    createdAt: ts('created_at').defaultNow().notNull(),
    updatedAt: ts('updated_at').defaultNow().notNull(),
    // plugin admin
    role: roleEnum('role').notNull().default('MEMBER'),
    banned: boolean('banned').notNull().default(false),
    banReason: text('ban_reason'),
    banExpires: ts('ban_expires'),
    // nossos
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    teamId: uuid('team_id').references(() => teams.id, { onDelete: 'set null' }),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
  },
  (t) => [index('users_tenant_team_idx').on(t.tenantId, t.teamId)],
)

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    expiresAt: ts('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: ts('created_at').defaultNow().notNull(),
    updatedAt: ts('updated_at').defaultNow().notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    impersonatedBy: text('impersonated_by'),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
)

export const accounts = pgTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: ts('access_token_expires_at'),
    refreshTokenExpiresAt: ts('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: ts('created_at').defaultNow().notNull(),
    updatedAt: ts('updated_at').defaultNow().notNull(),
  },
  (t) => [index('accounts_user_idx').on(t.userId)],
)

export const verifications = pgTable(
  'verifications',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: ts('expires_at').notNull(),
    createdAt: ts('created_at').defaultNow().notNull(),
    updatedAt: ts('updated_at').defaultNow().notNull(),
  },
  (t) => [index('verifications_identifier_idx').on(t.identifier)],
)

export const taskStatusEnum = pgEnum('task_status', [
  'pending',
  'in_progress',
  'paused',
  'finished',
  'cancelled',
])
export type TaskStatus = (typeof taskStatusEnum.enumValues)[number]
export const priorityEnum = pgEnum('priority', ['low', 'medium', 'high', 'urgent'])
export type Priority = (typeof priorityEnum.enumValues)[number]

export const challenges = pgTable(
  'challenges',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    teamId: uuid('team_id')
      .references(() => teams.id, { onDelete: 'cascade' })
      .notNull(),
    createdById: text('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    title: varchar('title', { length: 200 }).notNull(),
    description: text('description'),
    basePoints: integer('base_points').notNull().default(10),
    estimatedSeconds: integer('estimated_seconds').notNull(),
    archivedAt: ts('archived_at'),
    createdAt: ts('created_at').defaultNow().notNull(),
  },
  (t) => [index('challenges_team_idx').on(t.teamId, t.archivedAt)],
)

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    teamId: uuid('team_id')
      .references(() => teams.id, { onDelete: 'cascade' })
      .notNull(),
    assignedToId: text('assigned_to_id').references(() => users.id, { onDelete: 'set null' }),
    createdById: text('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    challengeId: uuid('challenge_id').references(() => challenges.id, { onDelete: 'set null' }),
    title: varchar('title', { length: 200 }).notNull(),
    description: text('description'),
    basePoints: integer('base_points').notNull().default(10),
    estimatedSeconds: integer('estimated_seconds').notNull(),
    status: taskStatusEnum('status').notNull().default('pending'),
    priority: priorityEnum('priority').notNull().default('medium'),
    sortOrder: doublePrecision('sort_order').notNull().default(0),
    dueDate: date('due_date'),
    scheduledStart: date('scheduled_start'),
    scheduledEnd: date('scheduled_end'),
    startedAt: ts('started_at'),
    finishedAt: ts('finished_at'),
    movingSeconds: integer('moving_seconds'),
    elapsedSeconds: integer('elapsed_seconds'),
    awardedPoints: integer('awarded_points'),
    needsValidation: boolean('needs_validation').notNull().default(false),
    manualFinish: boolean('manual_finish').notNull().default(false),
    createdAt: ts('created_at').defaultNow().notNull(),
  },
  (t) => [
    index('tasks_tenant_status_idx').on(t.tenantId, t.status),
    index('tasks_tenant_assigned_idx').on(t.tenantId, t.assignedToId),
    index('tasks_team_assigned_idx').on(t.teamId, t.assignedToId),
    index('tasks_challenge_idx').on(t.challengeId),
  ],
)

export const taskTimeLogs = pgTable(
  'task_time_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    taskId: uuid('task_id')
      .references(() => tasks.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    startedAt: ts('started_at').notNull(),
    stoppedAt: ts('stopped_at'),
    durationSeconds: integer('duration_seconds'),
  },
  (t) => [
    index('task_logs_task_idx').on(t.taskId),
    index('task_logs_user_open_idx').on(t.userId, t.stoppedAt),
  ],
)

export const taskDependencies = pgTable(
  'task_dependencies',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    taskId: uuid('task_id')
      .references(() => tasks.id, { onDelete: 'cascade' })
      .notNull(),
    dependsOnTaskId: uuid('depends_on_task_id')
      .references(() => tasks.id, { onDelete: 'cascade' })
      .notNull(),
    createdAt: ts('created_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('task_dep_unique_idx').on(t.taskId, t.dependsOnTaskId),
    index('task_dep_tenant_idx').on(t.tenantId),
    index('task_dep_depends_idx').on(t.dependsOnTaskId),
  ],
)

export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    teamId: uuid('team_id').references(() => teams.id, { onDelete: 'set null' }),
    email: text('email').notNull(),
    role: roleEnum('role').notNull().default('MEMBER'),
    token: text('token').notNull().unique(),
    invitedById: text('invited_by_id').references(() => users.id, { onDelete: 'set null' }),
    expiresAt: ts('expires_at').notNull(),
    acceptedAt: ts('accepted_at'),
    createdAt: ts('created_at').defaultNow().notNull(),
  },
  (t) => [index('invitations_tenant_idx').on(t.tenantId, t.acceptedAt)],
)
