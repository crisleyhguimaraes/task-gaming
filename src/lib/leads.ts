import { z } from 'zod'
import type { LeadStatus } from '#/db/schema'

export const leadSources = ['site', 'indicacao', 'evento', 'outbound', 'outro'] as const
export type LeadSource = (typeof leadSources)[number]

export const leadSourceLabels: Record<LeadSource, string> = {
  site: 'Site',
  indicacao: 'Indicação',
  evento: 'Evento',
  outbound: 'Outbound',
  outro: 'Outro',
}

export const leadStatusLabels: Record<LeadStatus, string> = {
  new: 'Novo',
  contacted: 'Contatado',
  qualified: 'Qualificado',
  disqualified: 'Desqualificado',
}

export const leadStatuses = Object.keys(leadStatusLabels) as Array<LeadStatus>

export const maxImportRows = 2000
export const leadsPageSize = 25

/** Valor de `ownerId` nos filtros para "leads sem dono". */
export const poolOwnerFilter = 'pool'

const minPhoneDigits = 8
const maxPhoneDigits = 20
const maxLength = { name: 160, company: 160, email: 200, phone: 40 }

export const normalizeEmail = (email: string) => email.trim().toLowerCase()
export const normalizePhone = (phone: string) => phone.replace(/\D/g, '')

export type LeadField = 'name' | 'company' | 'email' | 'phone'
export type RawLeadRow = Partial<Record<LeadField | 'source', string | null | undefined>>
export type LeadRowErrors = Partial<Record<LeadField, string>>

export type ParsedLead = {
  name: string
  company: string | null
  email: string | null
  emailNormalized: string | null
  phone: string | null
  phoneDigits: string | null
  source: LeadSource
}

export type LeadRowResult = { ok: true; lead: ParsedLead } | { ok: false; errors: LeadRowErrors }

const blankToNull = (value: string | null | undefined) => value?.trim() || null

const withoutAccents = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase()

export const parseSource = (raw: string | null | undefined): LeadSource => leadSources.find((s) => s === withoutAccents(raw ?? '')) ?? 'outro'

const tooLong = (field: LeadField, value: string | null) =>
  value && value.length > maxLength[field] ? `Aceita até ${maxLength[field]} caracteres` : undefined

const emailError = (email: string | null) => (email && !z.email().safeParse(email).success ? 'E-mail inválido' : tooLong('email', email))

function phoneError(phone: string | null, digits: string | null) {
  if (!phone || !digits) return undefined
  if (digits.length < minPhoneDigits) return `Telefone precisa de ao menos ${minPhoneDigits} dígitos`
  if (digits.length > maxPhoneDigits) return `Telefone aceita até ${maxPhoneDigits} dígitos`
  return tooLong('phone', phone)
}

const onlyFailures = (checks: Record<LeadField, string | undefined>) =>
  Object.fromEntries(Object.entries(checks).filter(([, message]) => message)) as LeadRowErrors

export function parseLeadRow(raw: RawLeadRow): LeadRowResult {
  const name = blankToNull(raw.name)
  const company = blankToNull(raw.company)
  const email = blankToNull(raw.email)
  const phone = blankToNull(raw.phone)
  const phoneDigits = phone ? normalizePhone(phone) : null

  const errors = onlyFailures({
    name: name ? tooLong('name', name) : 'Informe o nome',
    company: tooLong('company', company),
    email: emailError(email),
    phone: phoneError(phone, phoneDigits),
  })
  if (!name || Object.keys(errors).length > 0) return { ok: false, errors }

  return {
    ok: true,
    lead: { name, company, email, emailNormalized: email ? normalizeEmail(email) : null, phone, phoneDigits, source: parseSource(raw.source) },
  }
}

export const leadColumns = ['name', 'company', 'email', 'phone', 'source'] as const
export type LeadColumn = (typeof leadColumns)[number]
export type ColumnMapping = Partial<Record<LeadColumn, number>>

export const leadColumnLabels: Record<LeadColumn, string> = {
  name: 'Nome',
  company: 'Empresa',
  email: 'E-mail',
  phone: 'Telefone',
  source: 'Origem',
}

const columnAliases: Record<LeadColumn, ReadonlyArray<string>> = {
  name: ['nome', 'nome completo', 'name', 'contato'],
  company: ['empresa', 'company', 'organizacao'],
  email: ['email', 'e-mail', 'e mail', 'mail'],
  phone: ['telefone', 'phone', 'celular', 'whatsapp', 'fone'],
  source: ['origem', 'source', 'fonte'],
}

export function guessColumnMapping(headers: ReadonlyArray<string>): ColumnMapping {
  const normalized = headers.map(withoutAccents)
  const mapping: ColumnMapping = {}
  for (const column of leadColumns) {
    const index = normalized.findIndex((header) => columnAliases[column].includes(header))
    if (index >= 0) mapping[column] = index
  }
  return mapping
}

export function applyColumnMapping(rows: ReadonlyArray<ReadonlyArray<string>>, mapping: ColumnMapping): Array<RawLeadRow> {
  return rows.map((row) => {
    const cell = (column: LeadColumn) => (mapping[column] === undefined ? undefined : row[mapping[column]])
    return { name: cell('name'), company: cell('company'), email: cell('email'), phone: cell('phone'), source: cell('source') }
  })
}

export type OwnerLoad = { id: string; name: string; open: number }

/** Escolhe quem tem menos oportunidades abertas (empate: nome) e já conta a nova, para o próximo da fila. */
export function takeLeastLoaded(loads: Array<OwnerLoad>): OwnerLoad | undefined {
  const lighter = (a: OwnerLoad, b: OwnerLoad) => a.open < b.open || (a.open === b.open && a.name.localeCompare(b.name, 'pt-BR') < 0)
  const pick = loads.reduce<OwnerLoad | undefined>((best, load) => (!best || lighter(load, best) ? load : best), undefined)
  if (pick) pick.open += 1
  return pick
}
