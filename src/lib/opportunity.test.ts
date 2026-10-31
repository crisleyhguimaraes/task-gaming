import { describe, expect, it } from 'vitest'
import type { StageKind } from '#/db/schema'
import type { TeamRole } from '#/lib/access'
import type { AuthCtx } from '#/server/roles'
import { canEditRecord, lostReasonFor, planMove } from './opportunity'

const stage = (id: string, kind: StageKind) => ({ id, kind })
const open = stage('open', 'open')
const otherOpen = stage('other-open', 'open')
const won = stage('won', 'won')
const lost = stage('lost', 'lost')
const now = new Date('2026-03-10T12:00:00Z')

describe('planMove', () => {
  it('soltar na mesma etapa sem posição não muda nada', () => {
    expect(planMove(open, open, {}, now)).toEqual({ type: 'unchanged' })
  })

  it('soltar na mesma etapa com posição só reordena, inclusive na posição zero', () => {
    expect(planMove(open, open, { sortOrder: 7 }, now)).toEqual({ type: 'reorder', sortOrder: 7 })
    expect(planMove(open, open, { sortOrder: 0 }, now)).toEqual({ type: 'reorder', sortOrder: 0 })
  })

  it.each([
    ['entre etapas abertas', open, otherOpen, { action: 'opportunity.moved', closedAt: null, reopens: false }],
    ['entrar em ganha fecha agora', open, won, { action: 'opportunity.won', closedAt: now, reopens: false }],
    ['entrar em perdida fecha agora', open, lost, { action: 'opportunity.lost', closedAt: now, reopens: false }],
    ['sair de ganha para aberta reabre e exige a capability', won, open, { action: 'opportunity.reopened', closedAt: null, reopens: true }],
    ['sair de perdida para aberta reabre e exige a capability', lost, open, { action: 'opportunity.reopened', closedAt: null, reopens: true }],
    ['trocar fechada por outra fechada também exige a capability e vale a nova classificação', won, lost, { action: 'opportunity.lost', closedAt: now, reopens: true }],
    ['de perdida para ganha', lost, won, { action: 'opportunity.won', closedAt: now, reopens: true }],
  ] as const)('%s', (_name, from, to, expected) => {
    expect(planMove(from, to, {}, now)).toEqual({ type: 'change', ...expected })
  })
})

describe('lostReasonFor', () => {
  it('só perder pede motivo; nas outras etapas o motivo é descartado', () => {
    expect(lostReasonFor(open, 'qualquer coisa')).toBeNull()
    expect(lostReasonFor(won, 'ignorado')).toBeNull()
    expect(lostReasonFor(open, undefined)).toBeNull()
  })

  it('guarda o motivo sem os espaços das pontas', () => {
    expect(lostReasonFor(lost, '  Preço acima do orçamento ')).toBe('Preço acima do orçamento')
  })

  it('aceita o mínimo de 3 caracteres', () => {
    expect(lostReasonFor(lost, 'abc')).toBe('abc')
  })

  it.each([undefined, '', '   ', 'ab', ' ab '])('recusa motivo ausente ou curto demais: %j', (reason) => {
    expect(() => lostReasonFor(lost, reason)).toThrow('motivo da perda')
  })
})

describe('canEditRecord', () => {
  const ctx = (userId: string, role: AuthCtx['role'], teamId: string | null, teamRole: TeamRole = 'MEMBER'): AuthCtx => ({
    userId,
    tenantId: 't',
    role,
    memberships: teamId ? [{ teamId, role: teamRole }] : [],
    name: userId,
    impersonatedBy: null,
    mustChangePassword: false,
    capabilityOverrides: {},
  })
  const admin = ctx('admin', 'TENANT_ADMIN', null)
  const leader = ctx('leader', 'MEMBER', 'a', 'LEADER')
  const member = ctx('member', 'MEMBER', 'a')
  const colleague = ctx('colleague', 'MEMBER', 'a')
  const stranger = ctx('stranger', 'MEMBER', 'b')
  const unowned = { teamId: 'a', ownerId: null }
  const ownedByMember = { teamId: 'a', ownerId: 'member' }

  it('sem dono, qualquer um que enxergue a equipe edita', () => {
    expect([admin, leader, member, colleague].map((me) => canEditRecord(me, unowned))).toEqual([true, true, true, true])
  })

  it('com dono, só o dono ou um gestor editam', () => {
    expect(canEditRecord(member, ownedByMember)).toBe(true)
    expect(canEditRecord(leader, ownedByMember)).toBe(true)
    expect(canEditRecord(admin, ownedByMember)).toBe(true)
    expect(canEditRecord(colleague, ownedByMember)).toBe(false)
  })

  it('quem não enxerga a equipe não edita nem sem dono', () => {
    expect(canEditRecord(stranger, unowned)).toBe(false)
    expect(canEditRecord(stranger, ownedByMember)).toBe(false)
  })
})
