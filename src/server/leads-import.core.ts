import { and, asc, eq, inArray, or } from 'drizzle-orm'
import { db } from '#/db'
import { leads } from '#/db/schema'
import { diffFields } from '#/lib/audit'
import type { ParsedLead, RawLeadRow } from '#/lib/leads'
import { maxImportRows, parseLeadRow, takeLeastLoaded } from '#/lib/leads'
import { recordAudit } from './audit.core'
import { teamLoads } from './leads.core'
import type { AuthCtx } from './roles'
import { canManage, fail, forbid, requireCan } from './roles'
import { assertTeamInTenant } from './teams.core'
import type { Reader } from './tx'

export type ImportRequest = { teamId: string; rows: Array<RawLeadRow> }
export type ImportOptions = ImportRequest & { onDuplicate: 'skip' | 'update'; distribute: 'none' | 'least_loaded' }
export type ImportResult = {
  created: number
  updated: number
  skipped: number
  /** `row` é a posição na lista recebida, começando em 1. */
  errors: Array<{ row: number; messages: Array<string> }>
}

type ExistingLead = { id: string; teamId: string }

type RowPlan =
  | { row: number; kind: 'invalid'; messages: Array<string> }
  | { row: number; kind: 'repeated' }
  | { row: number; kind: 'new'; lead: ParsedLead }
  | { row: number; kind: 'duplicate'; lead: ParsedLead; existing: ExistingLead }

export type RowPreview = { row: number; status: RowPlan['kind']; messages: Array<string> }

type Contact = { emailNormalized: string | null; phoneDigits: string | null }

const contactKeys = ({ emailNormalized, phoneDigits }: Contact) => [
  ...(emailNormalized ? [`email:${emailNormalized}`] : []),
  ...(phoneDigits ? [`phone:${phoneDigits}`] : []),
]

/** Chave de contato -> lead mais antigo do tenant que a usa, de qualquer equipe. */
async function existingLeadsByContact(tx: Reader, tenantId: string, parsed: Array<ParsedLead>) {
  const emails = parsed.flatMap((lead) => (lead.emailNormalized ? [lead.emailNormalized] : []))
  const phones = parsed.flatMap((lead) => (lead.phoneDigits ? [lead.phoneDigits] : []))
  const byContact = new Map<string, ExistingLead>()
  const sameContact = or(emails.length > 0 ? inArray(leads.emailNormalized, emails) : undefined, phones.length > 0 ? inArray(leads.phoneDigits, phones) : undefined)
  if (!sameContact) return byContact
  const rows = await tx
    .select({ id: leads.id, teamId: leads.teamId, emailNormalized: leads.emailNormalized, phoneDigits: leads.phoneDigits })
    .from(leads)
    .where(and(eq(leads.tenantId, tenantId), sameContact))
    .orderBy(asc(leads.createdAt), asc(leads.id))
  for (const row of rows) for (const key of contactKeys(row)) if (!byContact.has(key)) byContact.set(key, { id: row.id, teamId: row.teamId })
  return byContact
}

/** Classifica cada linha antes de gravar; a prévia e a importação partem do mesmo plano. */
async function planImport(tx: Reader, tenantId: string, rows: Array<RawLeadRow>): Promise<Array<RowPlan>> {
  const parsed = rows.map((raw, index) => ({ row: index + 1, result: parseLeadRow(raw) }))
  const valid = parsed.flatMap(({ result }) => (result.ok ? [result.lead] : []))
  const existing = await existingLeadsByContact(tx, tenantId, valid)
  const seenInFile = new Set<string>()
  return parsed.map(({ row, result }): RowPlan => {
    if (!result.ok) return { row, kind: 'invalid', messages: Object.values(result.errors) }
    const keys = contactKeys(result.lead)
    if (keys.some((key) => seenInFile.has(key))) return { row, kind: 'repeated' }
    keys.forEach((key) => seenInFile.add(key))
    const found = keys.map((key) => existing.get(key)).find((lead) => lead !== undefined)
    return found ? { row, kind: 'duplicate', lead: result.lead, existing: found } : { row, kind: 'new', lead: result.lead }
  })
}

async function authorizeImport(tx: Reader, me: AuthCtx, { teamId, rows }: ImportRequest) {
  requireCan(me, 'lead.import')
  if (rows.length > maxImportRows) fail(`Importe no máximo ${maxImportRows} linhas por vez`)
  await assertTeamInTenant(tx, me.tenantId, teamId)
  if (!canManage(me, { teamId })) forbid()
}

export async function previewLeadImportFor(me: AuthCtx, request: ImportRequest): Promise<Array<RowPreview>> {
  await authorizeImport(db, me, request)
  const plans = await planImport(db, me.tenantId, request.rows)
  return plans.map((plan) => ({ row: plan.row, status: plan.kind, messages: plan.kind === 'invalid' ? plan.messages : [] }))
}

// NOTE: campo em branco na planilha não apaga o que já existe; `undefined` faz o Drizzle ignorar a coluna.
const refreshedFields = (lead: ParsedLead) => ({
  name: lead.name,
  company: lead.company ?? undefined,
  email: lead.email ?? undefined,
  emailNormalized: lead.emailNormalized ?? undefined,
  phone: lead.phone ?? undefined,
  phoneDigits: lead.phoneDigits ?? undefined,
})

const auditedLeadFields = ['name', 'company', 'email', 'phone'] as const

type DuplicatePlan = Extract<RowPlan, { kind: 'duplicate' }>
type Writer = Pick<typeof db, 'select' | 'insert' | 'update'>

/** Só chega aqui duplicado da equipe da importação: a autorização checou `canManage` para ela, não para as outras. */
async function refreshDuplicates(tx: Writer, me: AuthCtx, teamId: string, duplicates: Array<DuplicatePlan>) {
  if (duplicates.length === 0) return
  const scope = (ids: Array<string>) => and(inArray(leads.id, ids), eq(leads.tenantId, me.tenantId), eq(leads.teamId, teamId))
  const before = new Map((await tx.select().from(leads).where(scope(duplicates.map((d) => d.existing.id)))).map((lead) => [lead.id, lead]))
  for (const { lead, existing } of duplicates) {
    const previous = before.get(existing.id)
    const [after] = await tx.update(leads).set(refreshedFields(lead)).where(scope([existing.id])).returning()
    if (!previous || !after) continue
    const changes = diffFields(previous, after, auditedLeadFields)
    if (Object.keys(changes).length > 0) {
      await recordAudit(tx, me, { action: 'lead.updated', entityType: 'lead', entityId: existing.id, changes, meta: { via: 'importação' } })
    }
  }
}

export async function importLeadsFor(me: AuthCtx, options: ImportOptions): Promise<ImportResult> {
  const { teamId, rows, onDuplicate, distribute } = options
  return db.transaction(async (tx) => {
    await authorizeImport(tx, me, options)
    const plans = await planImport(tx, me.tenantId, rows)
    const loads = distribute === 'least_loaded' ? await teamLoads(tx, me.tenantId, teamId) : []

    const newLeads = plans.flatMap((plan) =>
      plan.kind === 'new'
        ? [{ ...plan.lead, tenantId: me.tenantId, teamId, ownerId: takeLeastLoaded(loads)?.id ?? null, createdById: me.userId }]
        : [],
    )
    if (newLeads.length > 0) await tx.insert(leads).values(newLeads)

    const duplicates = plans.filter((plan): plan is DuplicatePlan => plan.kind === 'duplicate')
    const updatable = onDuplicate === 'update' ? duplicates.filter((plan) => plan.existing.teamId === teamId) : []
    await refreshDuplicates(tx, me, teamId, updatable)

    const result: ImportResult = {
      created: newLeads.length,
      updated: updatable.length,
      skipped: plans.filter((plan) => plan.kind === 'repeated').length + duplicates.length - updatable.length,
      errors: plans.flatMap((plan) => (plan.kind === 'invalid' ? [{ row: plan.row, messages: plan.messages }] : [])),
    }
    await recordAudit(tx, me, {
      action: 'lead.imported',
      entityType: 'team',
      entityId: teamId,
      meta: { created: result.created, updated: result.updated, skipped: result.skipped, errors: result.errors.length, onDuplicate, distribute },
    })
    return result
  })
}
