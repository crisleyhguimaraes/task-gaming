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
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import type { Role, TeamRole } from '#/lib/access'
import { teamRoles, userRoles } from '#/lib/access'
import type { ScoringSnapshot } from '#/server/scoring'

export const roleEnum = pgEnum('role', userRoles)
export type { Role, TeamRole }

export const teamRoleEnum = pgEnum('team_role', teamRoles)

const ts = (name: string) => timestamp(name, { withTimezone: true })

/** Nome sem diferenciar maiúsculas nem espaços nas pontas: a base dos índices de nome único. */
const nameKey = () => text('name_key').generatedAlwaysAs(sql`lower(btrim(name))`)

export const tenants = pgTable('tenants', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 120 }).notNull(),
  slug: varchar('slug', { length: 60 }).notNull().unique(),
  timezone: varchar('timezone', { length: 64 })
    .notNull()
    .default('America/Sao_Paulo'),
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
    description: varchar('description', { length: 300 }),
    // NULL é "o padrão do tenant". Garantir que o item é do mesmo tenant fica no app: com FK composta, o SET NULL apagaria também o tenant_id.
    goalId: uuid('goal_id').references(() => goals.id, { onDelete: 'set null' }),
    scoringRuleId: uuid('scoring_rule_id').references(() => scoringRules.id, { onDelete: 'set null' }),
    nameKey: nameKey(),
    createdAt: ts('created_at').defaultNow().notNull(),
  },
  (t) => [
    index('teams_tenant_idx').on(t.tenantId),
    unique('teams_id_tenant_unique').on(t.id, t.tenantId),
    unique('teams_tenant_name_key_unique').on(t.tenantId, t.nameKey),
  ],
)

// Dias da semana como `Date#getUTCDay` e `extract(dow)`: 0 = domingo … 6 = sábado.
export const goals = pgTable(
  'goals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    name: varchar('name', { length: 80 }).notNull(),
    targetPoints: integer('target_points').notNull(),
    activeDays: smallint('active_days').array().notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    nameKey: nameKey(),
    createdAt: ts('created_at').defaultNow().notNull(),
    updatedAt: ts('updated_at').defaultNow().notNull().$onUpdate(() => new Date()),
  },
  (t) => [
    unique('goals_tenant_id_unique').on(t.tenantId, t.id),
    unique('goals_tenant_name_key_unique').on(t.tenantId, t.nameKey),
    uniqueIndex('goals_one_default_idx').on(t.tenantId).where(sql`${t.isDefault}`),
    check('goals_target_points_range', sql`${t.targetPoints} between 10 and 10000`),
    check('goals_active_days_valid', sql`cardinality(${t.activeDays}) between 1 and 7 and ${t.activeDays} <@ array[0,1,2,3,4,5,6]::smallint[]`),
  ],
)

const ruleColumn = (name: string) => integer(name).notNull()

// Limiares em % inteiro (ver ScoringRules). Os CHECKs repetem validateRules: a defesa de quem escreve direto no banco.
export const scoringRules = pgTable(
  'scoring_rules',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    name: varchar('name', { length: 80 }).notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    validateBelowPct: ruleColumn('validate_below_pct'),
    paceBelowPct: ruleColumn('pace_below_pct'),
    paceBonusPct: ruleColumn('pace_bonus_pct'),
    overtimeAbovePct: ruleColumn('overtime_above_pct'),
    overtimeStepPct: ruleColumn('overtime_step_pct'),
    overtimePenaltyPct: ruleColumn('overtime_penalty_pct'),
    pauseBelowPct: ruleColumn('pause_below_pct'),
    pausePenaltyPct: ruleColumn('pause_penalty_pct'),
    floorPct: ruleColumn('floor_pct'),
    capMultiplier: ruleColumn('cap_multiplier'),
    capMinMinutes: ruleColumn('cap_min_minutes'),
    nameKey: nameKey(),
    createdAt: ts('created_at').defaultNow().notNull(),
    updatedAt: ts('updated_at').defaultNow().notNull().$onUpdate(() => new Date()),
  },
  (t) => [
    unique('scoring_rules_tenant_id_unique').on(t.tenantId, t.id),
    unique('scoring_rules_tenant_name_key_unique').on(t.tenantId, t.nameKey),
    uniqueIndex('scoring_rules_one_default_idx').on(t.tenantId).where(sql`${t.isDefault}`),
    check(
      'scoring_rules_percents_non_negative',
      sql`${t.validateBelowPct} >= 0 and ${t.paceBelowPct} >= 0 and ${t.paceBonusPct} >= 0 and ${t.overtimeAbovePct} >= 0 and ${t.overtimeStepPct} >= 0 and ${t.overtimePenaltyPct} >= 0 and ${t.pauseBelowPct} >= 0 and ${t.pausePenaltyPct} >= 0 and ${t.floorPct} >= 0`,
    ),
    check(
      'scoring_rules_percents_max',
      sql`${t.validateBelowPct} <= 1000 and ${t.paceBelowPct} <= 1000 and ${t.paceBonusPct} <= 1000 and ${t.overtimeAbovePct} <= 1000 and ${t.overtimeStepPct} <= 1000 and ${t.overtimePenaltyPct} <= 1000 and ${t.pauseBelowPct} <= 1000 and ${t.pausePenaltyPct} <= 1000`,
    ),
    check('scoring_rules_thresholds_ascending', sql`${t.validateBelowPct} < ${t.paceBelowPct} and ${t.paceBelowPct} < ${t.overtimeAbovePct}`),
    check('scoring_rules_floor_range', sql`${t.floorPct} between 1 and 100`),
    check('scoring_rules_overtime_step_positive', sql`${t.overtimeStepPct} >= 1`),
    check('scoring_rules_cap_positive', sql`${t.capMultiplier} >= 1 and ${t.capMinMinutes} >= 1`),
    check('scoring_rules_cap_max', sql`${t.capMultiplier} <= 100 and ${t.capMinMinutes} <= 1440`),
  ],
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
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
  },
  (t) => [unique('users_id_tenant_unique').on(t.id, t.tenantId)],
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

// O board só agrupa tarefas: as colunas continuam sendo o status do cronômetro.
export const boards = pgTable(
  'boards',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    name: varchar('name', { length: 80 }).notNull(),
    archivedAt: ts('archived_at'),
    nameKey: nameKey(),
    createdAt: ts('created_at').defaultNow().notNull(),
  },
  (t) => [
    unique('boards_tenant_id_unique').on(t.tenantId, t.id),
    uniqueIndex('boards_active_name_idx').on(t.tenantId, t.nameKey).where(sql`${t.archivedAt} is null`),
  ],
)

export const boardTeams = pgTable(
  'board_teams',
  {
    boardId: uuid('board_id').notNull(),
    teamId: uuid('team_id').notNull(),
    tenantId: uuid('tenant_id').notNull(),
    createdAt: ts('created_at').defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.boardId, t.teamId] }),
    foreignKey({ name: 'board_teams_board_tenant_fk', columns: [t.tenantId, t.boardId], foreignColumns: [boards.tenantId, boards.id] }).onDelete('cascade'),
    foreignKey({ name: 'board_teams_team_tenant_fk', columns: [t.teamId, t.tenantId], foreignColumns: [teams.id, teams.tenantId] }).onDelete('cascade'),
    index('board_teams_team_idx').on(t.teamId),
  ],
)

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
    // Aberto a todas as equipes do tenant, além da dona.
    tenantWide: boolean('tenant_wide').notNull().default(false),
    archivedAt: ts('archived_at'),
    createdAt: ts('created_at').defaultNow().notNull(),
  },
  (t) => [
    index('challenges_team_idx').on(t.teamId, t.archivedAt),
    unique('challenges_tenant_id_unique').on(t.tenantId, t.id),
    check('challenges_scored_attempts_positive', sql`${t.scoredAttemptsPerDay} >= 1`),
  ],
)

// A equipe dona (challenges.team_id) fica implícita e não entra aqui.
export const challengeTeams = pgTable(
  'challenge_teams',
  {
    challengeId: uuid('challenge_id').notNull(),
    teamId: uuid('team_id').notNull(),
    tenantId: uuid('tenant_id').notNull(),
    createdAt: ts('created_at').defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.challengeId, t.teamId] }),
    foreignKey({ name: 'challenge_teams_challenge_tenant_fk', columns: [t.tenantId, t.challengeId], foreignColumns: [challenges.tenantId, challenges.id] }).onDelete('cascade'),
    foreignKey({ name: 'challenge_teams_team_tenant_fk', columns: [t.teamId, t.tenantId], foreignColumns: [teams.id, teams.tenantId] }).onDelete('cascade'),
    index('challenge_teams_team_idx').on(t.teamId),
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
    boardId: uuid('board_id'),
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
    // A regra efetiva gravada no primeiro start. NULL: tarefa anterior às regras (ou ainda não iniciada), que vale a de fábrica.
    scoringSnapshot: jsonb('scoring_snapshot').$type<ScoringSnapshot>(),
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
    // NULL é "sem board". Restrict: o board com tarefa não se apaga.
    foreignKey({ name: 'tasks_board_tenant_fk', columns: [t.tenantId, t.boardId], foreignColumns: [boards.tenantId, boards.id] }).onDelete('restrict'),
    index('tasks_board_idx').on(t.boardId),
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
    teamRole: teamRoleEnum('team_role').notNull().default('MEMBER'),
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

// Ajuste por tenant sobre defaultGrants (roles.ts), por papel dentro da equipe. Linha ausente = padrão de fábrica.
export const roleCapabilities = pgTable(
  'role_capabilities',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    role: teamRoleEnum('role').notNull(),
    capability: varchar('capability', { length: 40 }).notNull(),
    allowed: boolean('allowed').notNull(),
  },
  (t) => [uniqueIndex('role_capabilities_unique_idx').on(t.tenantId, t.role, t.capability)],
)

export const stageKindEnum = pgEnum('stage_kind', ['open', 'won', 'lost'])
export type StageKind = (typeof stageKindEnum.enumValues)[number]
export const leadStatusEnum = pgEnum('lead_status', ['new', 'contacted', 'qualified', 'disqualified'])
export type LeadStatus = (typeof leadStatusEnum.enumValues)[number]

export const pipelines = pgTable(
  'pipelines',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    name: varchar('name', { length: 80 }).notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    archivedAt: ts('archived_at'),
    nameKey: nameKey(),
    createdAt: ts('created_at').defaultNow().notNull(),
  },
  (t) => [
    unique('pipelines_tenant_id_unique').on(t.tenantId, t.id),
    uniqueIndex('pipelines_one_default_idx').on(t.tenantId).where(sql`${t.isDefault}`),
    uniqueIndex('pipelines_active_name_idx').on(t.tenantId, t.nameKey).where(sql`${t.archivedAt} is null`),
  ],
)

// As FKs compostas por tenant tornam impossível, no banco, vincular recurso de outro tenant à equipe.
export const teamPipelines = pgTable(
  'team_pipelines',
  {
    pipelineId: uuid('pipeline_id').notNull(),
    teamId: uuid('team_id').notNull(),
    tenantId: uuid('tenant_id').notNull(),
    createdAt: ts('created_at').defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.pipelineId, t.teamId] }),
    foreignKey({ name: 'team_pipelines_pipeline_tenant_fk', columns: [t.tenantId, t.pipelineId], foreignColumns: [pipelines.tenantId, pipelines.id] }).onDelete('cascade'),
    foreignKey({ name: 'team_pipelines_team_tenant_fk', columns: [t.teamId, t.tenantId], foreignColumns: [teams.id, teams.tenantId] }).onDelete('cascade'),
    index('team_pipelines_team_idx').on(t.teamId),
  ],
)

export const pipelineStages = pgTable(
  'pipeline_stages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    pipelineId: uuid('pipeline_id').notNull(),
    name: varchar('name', { length: 60 }).notNull(),
    sortOrder: doublePrecision('sort_order').notNull(),
    kind: stageKindEnum('kind').notNull().default('open'),
    probability: integer('probability').notNull().default(0),
    createdAt: ts('created_at').defaultNow().notNull(),
  },
  (t) => [
    foreignKey({ name: 'pipeline_stages_pipeline_tenant_fk', columns: [t.tenantId, t.pipelineId], foreignColumns: [pipelines.tenantId, pipelines.id] }).onDelete('restrict'),
    unique('pipeline_stages_pipeline_id_unique').on(t.pipelineId, t.id),
    index('pipeline_stages_pipeline_idx').on(t.pipelineId, t.sortOrder),
    check('pipeline_stages_probability', sql`${t.probability} between 0 and 100`),
  ],
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
    pipelineId: uuid('pipeline_id').notNull(),
    stageId: uuid('stage_id').notNull(),
    closedAt: ts('closed_at'),
    lostReason: text('lost_reason'),
    sortOrder: doublePrecision('sort_order').notNull().default(0),
    createdById: text('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').defaultNow().notNull(),
    updatedAt: ts('updated_at').defaultNow().notNull().$onUpdate(() => new Date()),
  },
  (t) => [
    // A oportunidade nunca cruza de pipeline: a etapa tem de ser do pipeline dela.
    foreignKey({ name: 'opportunities_pipeline_stage_fk', columns: [t.pipelineId, t.stageId], foreignColumns: [pipelineStages.pipelineId, pipelineStages.id] }).onDelete('restrict'),
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
