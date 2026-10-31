import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
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

export const teamRoleEnum = pgEnum('team_role', ['LEADER', 'MEMBER'])
export type TeamRole = (typeof teamRoleEnum.enumValues)[number]

const ts = (name: string) => timestamp(name, { withTimezone: true })

export const tenants = pgTable('tenants', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 120 }).notNull(),
  slug: varchar('slug', { length: 60 }).notNull().unique(),
  timezone: varchar('timezone', { length: 64 })
    .notNull()
    .default('America/Sao_Paulo'),
  dailyGoalPoints: integer('daily_goal_points').notNull().default(100),
  requireTwoFactor: boolean('require_two_factor').notNull().default(false),
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
  (t) => [index('teams_tenant_idx').on(t.tenantId), unique('teams_id_tenant_unique').on(t.id, t.tenantId)],
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
    twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
  },
  (t) => [index('users_tenant_team_idx').on(t.tenantId, t.teamId), unique('users_id_tenant_unique').on(t.id, t.tenantId)],
)

// As FKs compostas tornam impossível, no banco, alguém de outro tenant numa equipe.
// CASCADE também na equipe: com NO ACTION, apagar o tenant falha, porque a cascata apaga as equipes antes dos usuários e a checagem roda com os vínculos ainda de pé.
export const teamMembers = pgTable(
  'team_members',
  {
    teamId: uuid('team_id').notNull(),
    userId: text('user_id').notNull(),
    tenantId: uuid('tenant_id').notNull(),
    role: teamRoleEnum('role').notNull().default('MEMBER'),
    createdAt: ts('created_at').defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.teamId, t.userId] }),
    foreignKey({ name: 'team_members_team_tenant_fk', columns: [t.teamId, t.tenantId], foreignColumns: [teams.id, teams.tenantId] }).onDelete('cascade'),
    foreignKey({ name: 'team_members_user_tenant_fk', columns: [t.userId, t.tenantId], foreignColumns: [users.id, users.tenantId] }).onDelete('cascade'),
    index('team_members_user_idx').on(t.userId),
    index('team_members_tenant_team_role_idx').on(t.tenantId, t.teamId, t.role),
  ],
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
    scoredAttemptsPerDay: integer('scored_attempts_per_day').notNull().default(1),
    archivedAt: ts('archived_at'),
    createdAt: ts('created_at').defaultNow().notNull(),
  },
  (t) => [
    index('challenges_team_idx').on(t.teamId, t.archivedAt),
    check('challenges_scored_attempts_positive', sql`${t.scoredAttemptsPerDay} >= 1`),
  ],
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
    opportunityId: uuid('opportunity_id').references(() => opportunities.id, { onDelete: 'set null' }),
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
    rejectedAt: ts('rejected_at'),
    movingSeconds: integer('moving_seconds'),
    elapsedSeconds: integer('elapsed_seconds'),
    awardedPoints: integer('awarded_points'),
    needsValidation: boolean('needs_validation').notNull().default(false),
    manualFinish: boolean('manual_finish').notNull().default(false),
    createdAt: ts('created_at').defaultNow().notNull(),
    updatedAt: ts('updated_at').defaultNow().notNull().$onUpdate(() => new Date()),
  },
  (t) => [
    index('tasks_tenant_status_idx').on(t.tenantId, t.status),
    index('tasks_tenant_assigned_idx').on(t.tenantId, t.assignedToId),
    index('tasks_team_assigned_idx').on(t.teamId, t.assignedToId),
    index('tasks_challenge_idx').on(t.challengeId),
    uniqueIndex('tasks_open_attempt_idx')
      .on(t.challengeId, t.assignedToId)
      .where(sql`${t.challengeId} is not null and ${t.status} in ('pending', 'in_progress', 'paused')`),
    index('tasks_opportunity_idx').on(t.opportunityId),
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

export type AuditValue = string | number | boolean | null
export type AuditChanges = Record<string, { from: AuditValue; to: AuditValue }>
export type AuditMeta = Record<string, AuditValue>

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    // Sem FK: o evento precisa sobreviver à exclusão do usuário.
    actorId: text('actor_id'),
    actorName: text('actor_name').notNull(),
    impersonatedBy: text('impersonated_by'),
    action: varchar('action', { length: 60 }).notNull(),
    entityType: varchar('entity_type', { length: 40 }).notNull(),
    entityId: text('entity_id').notNull(),
    changes: jsonb('changes').$type<AuditChanges>(),
    meta: jsonb('meta').$type<AuditMeta>(),
    createdAt: ts('created_at').defaultNow().notNull(),
  },
  (t) => [
    index('audit_tenant_created_idx').on(t.tenantId, t.createdAt.desc()),
    index('audit_entity_idx').on(t.tenantId, t.entityType, t.entityId),
  ],
)

// Tabela do plugin twoFactor do Better Auth (mapeada em lib/auth.ts).
export const twoFactors = pgTable(
  'two_factors',
  {
    id: text('id').primaryKey(),
    secret: text('secret').notNull(),
    backupCodes: text('backup_codes').notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    verified: boolean('verified').notNull().default(true),
    failedVerificationCount: integer('failed_verification_count').notNull().default(0),
    lockedUntil: ts('locked_until'),
  },
  (t) => [index('two_factors_secret_idx').on(t.secret), index('two_factors_user_idx').on(t.userId)],
)

// Ajuste por tenant sobre defaultGrants (roles.ts). Linha ausente = padrão de fábrica.
export const roleCapabilities = pgTable(
  'role_capabilities',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    role: roleEnum('role').notNull(),
    capability: varchar('capability', { length: 40 }).notNull(),
    allowed: boolean('allowed').notNull(),
  },
  (t) => [uniqueIndex('role_capabilities_unique_idx').on(t.tenantId, t.role, t.capability)],
)

export const stageKindEnum = pgEnum('stage_kind', ['open', 'won', 'lost'])
export type StageKind = (typeof stageKindEnum.enumValues)[number]
export const leadStatusEnum = pgEnum('lead_status', ['new', 'contacted', 'qualified', 'disqualified'])
export type LeadStatus = (typeof leadStatusEnum.enumValues)[number]

export const pipelineStages = pgTable(
  'pipeline_stages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    name: varchar('name', { length: 60 }).notNull(),
    sortOrder: doublePrecision('sort_order').notNull(),
    kind: stageKindEnum('kind').notNull().default('open'),
    probability: integer('probability').notNull().default(0),
    createdAt: ts('created_at').defaultNow().notNull(),
  },
  (t) => [index('pipeline_stages_tenant_idx').on(t.tenantId, t.sortOrder), check('pipeline_stages_probability', sql`${t.probability} between 0 and 100`)],
)

export const leads = pgTable(
  'leads',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    // restrict: apagar equipe não pode levar o pipeline junto.
    teamId: uuid('team_id')
      .references(() => teams.id, { onDelete: 'restrict' })
      .notNull(),
    ownerId: text('owner_id').references(() => users.id, { onDelete: 'set null' }),
    name: varchar('name', { length: 160 }).notNull(),
    company: varchar('company', { length: 160 }),
    email: varchar('email', { length: 200 }),
    emailNormalized: varchar('email_normalized', { length: 200 }),
    phone: varchar('phone', { length: 40 }),
    phoneDigits: varchar('phone_digits', { length: 20 }),
    source: varchar('source', { length: 40 }).notNull().default('outro'),
    status: leadStatusEnum('status').notNull().default('new'),
    createdById: text('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').defaultNow().notNull(),
    updatedAt: ts('updated_at').defaultNow().notNull().$onUpdate(() => new Date()),
  },
  (t) => [
    index('leads_tenant_email_idx').on(t.tenantId, t.emailNormalized),
    index('leads_tenant_phone_idx').on(t.tenantId, t.phoneDigits),
    index('leads_team_owner_idx').on(t.teamId, t.ownerId),
    index('leads_tenant_status_idx').on(t.tenantId, t.status),
  ],
)

export const opportunities = pgTable(
  'opportunities',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    teamId: uuid('team_id')
      .references(() => teams.id, { onDelete: 'restrict' })
      .notNull(),
    leadId: uuid('lead_id')
      .references(() => leads.id, { onDelete: 'restrict' })
      .notNull(),
    ownerId: text('owner_id').references(() => users.id, { onDelete: 'set null' }),
    title: varchar('title', { length: 200 }).notNull(),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull().default(0),
    expectedCloseDate: date('expected_close_date'),
    stageId: uuid('stage_id')
      .references(() => pipelineStages.id, { onDelete: 'restrict' })
      .notNull(),
    closedAt: ts('closed_at'),
    lostReason: text('lost_reason'),
    sortOrder: doublePrecision('sort_order').notNull().default(0),
    createdById: text('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').defaultNow().notNull(),
    updatedAt: ts('updated_at').defaultNow().notNull().$onUpdate(() => new Date()),
  },
  (t) => [
    index('opportunities_tenant_stage_idx').on(t.tenantId, t.stageId),
    index('opportunities_team_owner_idx').on(t.teamId, t.ownerId),
    index('opportunities_lead_idx').on(t.leadId),
  ],
)

// Fonte do funil e do tempo em etapa; a trilha geral de quem fez o quê fica em audit_events.
export const opportunityStageChanges = pgTable(
  'opportunity_stage_changes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    opportunityId: uuid('opportunity_id')
      .references(() => opportunities.id, { onDelete: 'cascade' })
      .notNull(),
    fromStageId: uuid('from_stage_id').references(() => pipelineStages.id, { onDelete: 'restrict' }),
    toStageId: uuid('to_stage_id')
      .references(() => pipelineStages.id, { onDelete: 'restrict' })
      .notNull(),
    changedById: text('changed_by_id').references(() => users.id, { onDelete: 'set null' }),
    changedAt: ts('changed_at').defaultNow().notNull(),
  },
  (t) => [index('stage_changes_opportunity_idx').on(t.opportunityId, t.changedAt), index('stage_changes_tenant_idx').on(t.tenantId, t.changedAt)],
)

// Comentário em tarefa ou nota em lead/oportunidade: exatamente um alvo.
export const notes = pgTable(
  'notes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    authorId: text('author_id').references(() => users.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'cascade' }),
    opportunityId: uuid('opportunity_id').references(() => opportunities.id, { onDelete: 'cascade' }),
    createdAt: ts('created_at').defaultNow().notNull(),
  },
  (t) => [
    index('notes_task_idx').on(t.taskId, t.createdAt),
    index('notes_lead_idx').on(t.leadId, t.createdAt),
    index('notes_opportunity_idx').on(t.opportunityId, t.createdAt),
    check('notes_single_target', sql`num_nonnulls(${t.taskId}, ${t.leadId}, ${t.opportunityId}) = 1`),
  ],
)

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    type: varchar('type', { length: 60 }).notNull(),
    entityType: varchar('entity_type', { length: 40 }).notNull(),
    entityId: text('entity_id').notNull(),
    payload: jsonb('payload').$type<AuditMeta>(),
    readAt: ts('read_at'),
    createdAt: ts('created_at').defaultNow().notNull(),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.readAt, t.createdAt)],
)
