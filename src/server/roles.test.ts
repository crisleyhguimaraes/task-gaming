import { describe, expect, it } from 'vitest'
import { teamRoles } from '#/lib/access'
import type { Role, TeamRole } from '#/lib/access'
import type { AuthCtx } from './roles'
import { ForbiddenError, canAccessTeam, canManage, canSee, capabilities, capabilityScope, can, defaultGrants, defaultTeamId, forbid, isManager, isMemberOf, managedTeamIds, nonDelegableCapabilities, requireCan, roleIn } from './roles'

const A = 'team-a'
const B = 'team-b'

type Person = Pick<AuthCtx, 'userId' | 'role' | 'memberships' | 'capabilityOverrides'>

const person = (role: Role, memberships: Array<[string, TeamRole]> = [], capabilityOverrides: AuthCtx['capabilityOverrides'] = {}): Person => ({
  userId: 'me',
  role,
  memberships: memberships.map(([teamId, teamRole]) => ({ teamId, role: teamRole })),
  capabilityOverrides,
})

const hierarchy = ['MEMBER', 'LEADER', 'TENANT_ADMIN', 'SUPER_ADMIN'] as const
type Level = (typeof hierarchy)[number]

const as = (level: Level, capabilityOverrides: AuthCtx['capabilityOverrides'] = {}) =>
  level === 'LEADER' || level === 'MEMBER' ? person('MEMBER', [[A, level]], capabilityOverrides) : person(level, [], capabilityOverrides)

describe('capabilities', () => {
  it('quem pode uma capability forma o topo da hierarquia: cada papel superior herda o que o inferior pode', () => {
    for (const cap of capabilities) {
      const granted = hierarchy.filter((role) => can(as(role), cap))

      expect(granted, cap).toEqual(hierarchy.slice(hierarchy.length - granted.length))
    }
  })

  it('criar tenants é exclusivo do SUPER_ADMIN', () => {
    expect(hierarchy.filter((r) => can(as(r), 'tenant.manage'))).toEqual(['SUPER_ADMIN'])
  })

  it('auditoria e gestão de equipes são de admin; líder gerencia usuários da equipe mas não altera papéis', () => {
    expect(can(as('LEADER'), 'audit.read')).toBe(false)
    expect(can(as('TENANT_ADMIN'), 'audit.read')).toBe(true)
    expect(can(as('LEADER'), 'team.manage')).toBe(false)
    expect(can(as('LEADER'), 'user.create')).toBe(true)
    expect(can(as('LEADER'), 'invitation.manage')).toBe(true)
    expect(can(as('LEADER'), 'user.update')).toBe(false)
  })

  it('membro comum não tem nenhuma capability de gestão', () => {
    const memberCaps = capabilities.filter((c) => can(as('MEMBER'), c))
    expect(memberCaps.sort()).toEqual(['lead.write', 'opportunity.write'])
  })

  it('toda capability tem ao menos um papel concedido', () => {
    for (const cap of capabilities) expect(defaultGrants[cap].length, cap).toBeGreaterThan(0)
  })

  it('requireCan lança "Sem permissão" quando o papel não tem a capability', () => {
    expect(() => requireCan(as('MEMBER'), 'audit.read')).toThrow('Sem permissão')
    expect(() => requireCan(as('TENANT_ADMIN'), 'audit.read')).not.toThrow()
  })
})

describe('team.member.manage', () => {
  const leaderOfAMemberOfB = (overrides: AuthCtx['capabilityOverrides'] = {}) => person('MEMBER', [[A, 'LEADER'], [B, 'MEMBER']], overrides)

  it('vale por equipe e o padrão é só de admin', () => {
    expect(capabilityScope['team.member.manage']).toBe('team')
    expect(hierarchy.filter((r) => can(as(r), 'team.member.manage'))).toEqual(['TENANT_ADMIN', 'SUPER_ADMIN'])
  })

  it('delegada ao líder, vale só nas equipes que ele lidera', () => {
    const me = leaderOfAMemberOfB({ LEADER: { 'team.member.manage': true } })

    expect(can(me, 'team.member.manage', A)).toBe(true)
    expect(can(me, 'team.member.manage', B)).toBe(false)
    expect(can(leaderOfAMemberOfB(), 'team.member.manage', A)).toBe(false)
  })
})

describe('overrides por tenant', () => {
  it('sem override vale o padrão de fábrica', () => {
    expect(can(as('MEMBER'), 'export.csv')).toBe(false)
    expect(can(as('LEADER'), 'export.csv')).toBe(true)
  })

  it('override concede o que o padrão nega', () => {
    expect(can(as('MEMBER', { MEMBER: { 'export.csv': true } }), 'export.csv')).toBe(true)
  })

  it('override revoga o que o padrão concede, e só a capability citada', () => {
    const leader = as('LEADER', { LEADER: { 'user.create': false } })

    expect(can(leader, 'user.create')).toBe(false)
    expect(can(leader, 'invitation.manage')).toBe(true)
  })
})

describe('capabilities não delegáveis', () => {
  it.each(nonDelegableCapabilities)('override de %s é ignorado, mesmo gravado: vale só o padrão de fábrica', (capability) => {
    for (const teamRole of teamRoles) {
      expect(can(as(teamRole, { [teamRole]: { [capability]: true } }), capability)).toBe(can(as(teamRole), capability))
      expect(can(as(teamRole, { [teamRole]: { [capability]: false } }), capability)).toBe(can(as(teamRole), capability))
    }
  })

  it('cobrem tudo o que vale para o tenant inteiro', () => {
    expect([...nonDelegableCapabilities].sort()).toEqual(['audit.read', 'goal.configure', 'permissions.manage', 'pipeline.configure', 'scoring.configure', 'team.manage', 'tenant.configure', 'tenant.manage', 'user.update'])
  })
})

describe('ForbiddenError', () => {
  it('forbid lança ForbiddenError com a mensagem padrão', () => {
    expect(() => forbid()).toThrow(ForbiddenError)
    expect(() => forbid()).toThrow('Sem permissão')
  })

  it('requireCan nega com ForbiddenError, tipado para o middleware reconhecer', () => {
    expect(() => requireCan(as('MEMBER'), 'audit.read')).toThrow(ForbiddenError)
  })
})

describe('can por equipe: quem tem papéis diferentes em equipes diferentes', () => {
  const leaderInAMemberInB = person('MEMBER', [[A, 'LEADER'], [B, 'MEMBER']])

  it('user.create vale na equipe que a pessoa lidera e não na que ela só integra', () => {
    expect(can(leaderInAMemberInB, 'user.create', A)).toBe(true)
    expect(can(leaderInAMemberInB, 'user.create', B)).toBe(false)
  })

  it('sem equipe informada é só o portão de entrada: vale se alguma das equipes concede', () => {
    expect(can(leaderInAMemberInB, 'user.create')).toBe(true)
    expect(can(person('MEMBER', [[A, 'MEMBER'], [B, 'MEMBER']]), 'user.create')).toBe(false)
  })

  it('override concedido ao líder não vale na equipe onde a pessoa é membro', () => {
    const me = person('MEMBER', [[A, 'LEADER'], [B, 'MEMBER']], { LEADER: { 'user.deactivate': true } })

    expect(can(me, 'user.deactivate', A)).toBe(true)
    expect(can(me, 'user.deactivate', B)).toBe(false)
  })

  it('override concedido ao membro não vale na equipe onde a pessoa é líder', () => {
    const me = person('MEMBER', [[A, 'LEADER'], [B, 'MEMBER']], { MEMBER: { 'user.deactivate': true } })

    expect(can(me, 'user.deactivate', A)).toBe(false)
    expect(can(me, 'user.deactivate', B)).toBe(true)
  })

  it('os poderes não se somam entre equipes: com teamId, só conta o papel naquela equipe', () => {
    const me = person('MEMBER', [[A, 'LEADER'], [B, 'MEMBER']], { MEMBER: { 'export.csv': false } })

    expect(can(me, 'export.csv', A)).toBe(true)
    expect(can(me, 'export.csv', B)).toBe(false)
  })

  it('quem não pertence à equipe não pode nela, nem com override', () => {
    const me = person('MEMBER', [[A, 'MEMBER']], { MEMBER: { 'export.csv': true } })

    expect(can(me, 'lead.write', B)).toBe(false)
    expect(can(me, 'export.csv', B)).toBe(false)
  })

  it('quem não tem equipe e não é admin usa o padrão de membro', () => {
    const teamless = person('MEMBER')

    expect(can(teamless, 'lead.write')).toBe(true)
    expect(can(teamless, 'user.create')).toBe(false)
    expect(can(person('MEMBER', [], { MEMBER: { 'export.csv': true } }), 'export.csv')).toBe(true)
  })

  it('admin vale o padrão de fábrica em qualquer equipe e ignora overrides', () => {
    const admin = person('TENANT_ADMIN', [], { LEADER: { 'audit.read': false, 'user.read': false }, MEMBER: { 'user.read': false } })

    expect(can(admin, 'user.read', A)).toBe(true)
    expect(can(admin, 'user.read')).toBe(true)
    expect(can(admin, 'audit.read', B)).toBe(true)
  })

  it('requireCan com equipe nega com ForbiddenError na equipe sem o poder', () => {
    expect(() => requireCan(leaderInAMemberInB, 'user.create', A)).not.toThrow()
    expect(() => requireCan(leaderInAMemberInB, 'user.create', B)).toThrow(ForbiddenError)
  })
})

describe('predicados sobre vínculos', () => {
  const me = person('MEMBER', [[A, 'LEADER'], [B, 'MEMBER']])
  const admin = person('TENANT_ADMIN')
  const teamless = person('MEMBER')

  it('roleIn devolve o papel na equipe, ou null sem vínculo', () => {
    expect(roleIn(me, A)).toBe('LEADER')
    expect(roleIn(me, B)).toBe('MEMBER')
    expect(roleIn(me, 'team-c')).toBeNull()
  })

  it('canManage: admin gerencia qualquer equipe e o líder só as que lidera', () => {
    expect(canManage(admin, { teamId: 'qualquer' })).toBe(true)
    expect(canManage(me, { teamId: A })).toBe(true)
    expect(canManage(me, { teamId: B })).toBe(false)
    expect(canManage(teamless, { teamId: A })).toBe(false)
  })

  it('canSee: gestor, responsável ou membro da equipe; os demais não', () => {
    expect(canSee(me, { teamId: A, assignedToId: null })).toBe(true)
    expect(canSee(me, { teamId: B, assignedToId: null })).toBe(true)
    expect(canSee(me, { teamId: 'team-c', assignedToId: null })).toBe(false)
    expect(canSee(me, { teamId: 'team-c', assignedToId: 'me' })).toBe(true)
    expect(canSee(admin, { teamId: 'team-c', assignedToId: null })).toBe(true)
  })

  it('canAccessTeam: admin entra em qualquer equipe e os demais só nas que integram', () => {
    expect(canAccessTeam(admin, 'qualquer')).toBe(true)
    expect(canAccessTeam(me, A)).toBe(true)
    expect(canAccessTeam(me, B)).toBe(true)
    expect(canAccessTeam(me, 'team-c')).toBe(false)
    expect(canAccessTeam(teamless, A)).toBe(false)
  })

  it('isMemberOf: só vínculo conta, nem o admin entra de graça', () => {
    expect(isMemberOf(me, B)).toBe(true)
    expect(isMemberOf(me, 'team-c')).toBe(false)
    expect(isMemberOf(admin, A)).toBe(false)
  })

  it('defaultTeamId: a primeira das minhas equipes (na ordem dos vínculos) que a lista oferece; sem vínculo, a primeira da lista; lista vazia, vazio', () => {
    const [x, y, z] = [{ id: 'team-x' }, { id: A }, { id: B }]

    expect(defaultTeamId(me, [x, z, y])).toBe(A)
    expect(defaultTeamId(me, [x, z])).toBe(B)
    expect(defaultTeamId(admin, [x, y])).toBe('team-x')
    expect(defaultTeamId(me, [])).toBe('')
  })

  it('managedTeamIds lista só as equipes que a pessoa lidera', () => {
    expect(managedTeamIds(me)).toEqual([A])
    expect(managedTeamIds(teamless)).toEqual([])
  })

  it('isManager: admin ou líder de alguma equipe', () => {
    expect(isManager(admin)).toBe(true)
    expect(isManager(me)).toBe(true)
    expect(isManager(person('MEMBER', [[A, 'MEMBER']]))).toBe(false)
    expect(isManager(teamless)).toBe(false)
  })
})

describe('capabilities de metas, pontuações e boards', () => {
  const leaderOfAMemberOfB = (overrides: AuthCtx['capabilityOverrides'] = {}) => person('MEMBER', [[A, 'LEADER'], [B, 'MEMBER']], overrides)

  it.each(['goal.configure', 'scoring.configure'] as const)('%s é do tenant, só de admin, e delegar não vale', (cap) => {
    expect(capabilityScope[cap]).toBe('tenant')
    expect(hierarchy.filter((r) => can(as(r), cap))).toEqual(['TENANT_ADMIN', 'SUPER_ADMIN'])
    expect(can(leaderOfAMemberOfB({ LEADER: { [cap]: true } }), cap, A)).toBe(false)
  })

  it('board.manage é de equipe: líder gerencia na equipe que lidera e só nela', () => {
    const leader = leaderOfAMemberOfB()

    expect(capabilityScope['board.manage']).toBe('team')
    expect(can(leader, 'board.manage', A)).toBe(true)
    expect(can(leader, 'board.manage', B)).toBe(false)
    expect(can(as('MEMBER'), 'board.manage')).toBe(false)
  })
})
