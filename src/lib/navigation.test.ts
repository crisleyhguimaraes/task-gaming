import { describe, expect, it } from 'vitest'
import type { Role, TeamRole } from '#/lib/access'
import type { AuthCtx } from '#/server/roles'
import { buildNav, isGroup } from './navigation'

type Person = Pick<AuthCtx, 'userId' | 'role' | 'memberships' | 'capabilityOverrides'>

const person = (role: Role, memberships: Array<[string, TeamRole]> = []): Person => ({
  userId: 'me',
  role,
  memberships: memberships.map(([teamId, teamRole]) => ({ teamId, role: teamRole })),
  capabilityOverrides: {},
})

const labels = (me: Person) => buildNav(me).flatMap((s) => s.items.map((i) => i.label))
const settingsGroup = (me: Person) => buildNav(me).flatMap((s) => s.items).find(isGroup)
const settingsOf = (me: Person) => settingsGroup(me)?.children.map((c) => c.label) ?? []

describe('buildNav', () => {
  it('membro vê o trabalho, o comercial e a equipe, sem configurações', () => {
    expect(labels(person('MEMBER', [['a', 'MEMBER']]))).toEqual(['Hoje', 'Desafios', 'Board', 'Pipeline', 'Leads', 'Equipe'])
  })

  it('as seções agrupam o menu por assunto', () => {
    expect(buildNav(person('MEMBER', [['a', 'MEMBER']])).map((s) => s.label)).toEqual(['Trabalho', 'Comercial', 'Equipe'])
  })

  it('admin ganha o grupo Configurações com as páginas que pode abrir', () => {
    expect(settingsOf(person('TENANT_ADMIN'))).toEqual(['Equipes', 'Usuários', 'Permissões', 'Pipelines', 'Boards', 'Metas e pontuação', 'Auditoria'])
  })

  it('líder vê só as configurações que a capability dele libera', () => {
    const leader = settingsOf(person('MEMBER', [['a', 'LEADER']]))
    expect(leader).toContain('Usuários')
    expect(leader).not.toContain('Permissões')
    expect(leader).not.toContain('Auditoria')
  })

  it('só o super admin vê Tenants', () => {
    expect(labels(person('TENANT_ADMIN'))).not.toContain('Tenants')
    expect(labels(person('SUPER_ADMIN'))).toContain('Tenants')
  })

  it('o grupo Configurações leva ao primeiro item visível', () => {
    expect(settingsGroup(person('TENANT_ADMIN'))?.to).toBe('/settings/teams')
  })
})
