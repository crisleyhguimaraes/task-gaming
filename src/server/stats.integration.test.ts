import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { tasks } from '#/db/schema'
import { attentionCount } from './stats'
import { addAdmin, addTeam, addUser, makeTenant } from './test-fixtures'

let f: Awaited<ReturnType<typeof makeTenant>>

const seed = (teamId: string, patch: Partial<typeof tasks.$inferInsert>) =>
  db.insert(tasks).values({ tenantId: f.tenant.id, teamId, createdById: f.leader.userId, title: 'T', basePoints: 10, estimatedSeconds: 600, ...patch })

beforeAll(async () => {
  f = await makeTenant(1)
  const teamB = await addTeam(f, 'B')
  await seed(f.team.id, {})
  await seed(f.team.id, { status: 'finished', needsValidation: true })
  await seed(teamB.id, { status: 'finished', needsValidation: true })
  await seed(teamB.id, { status: 'finished', needsValidation: true })
})
afterAll(async () => {
  await f.cleanup()
  await db.$client.end()
})

describe('attentionCount', () => {
  it('líder conta o pool e as validações da própria equipe', async () => {
    expect(await attentionCount(f.leader)).toEqual({ pool: 1, validation: 1 })
  })

  it('membro conta o pool e nenhuma validação', async () => {
    expect(await attentionCount(f.members[0]!)).toEqual({ pool: 1, validation: 0 })
  })

  it('admin conta as validações do tenant inteiro', async () => {
    const admin = await addAdmin(f)

    expect((await attentionCount(admin)).validation).toBe(3)
  })

  it('líder sem equipe não conta nada, sem erro', async () => {
    const teamlessLeader = await addUser(f, { role: 'TEAM_LEADER', team: null })

    expect(await attentionCount(teamlessLeader)).toEqual({ pool: 0, validation: 0 })
  })
})
