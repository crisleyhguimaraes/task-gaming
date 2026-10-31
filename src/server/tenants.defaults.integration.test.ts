import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { goals, scoringRules, tenants } from '#/db/schema'
import { BUSINESS_DAYS } from '#/lib/goals'
import { effectiveGoalsOf } from './goals.core'
import { FACTORY_RULES } from './scoring'
import { snapshotOfTeam } from './scoring-rules.core'
import { addAdmin, addTeam, addUser, makeTenant } from './test-fixtures'
import { createTenantFor } from './tenants.core'

let f: Awaited<ReturnType<typeof makeTenant>>
const createdTenants: Array<string> = []

const goalsOf = (tenantId: string) => db.select().from(goals).where(eq(goals.tenantId, tenantId))
const rulesOf = (tenantId: string) => db.select().from(scoringRules).where(eq(scoringRules.tenantId, tenantId))

beforeAll(async () => {
  f = await makeTenant(0)
})
afterAll(async () => {
  if (createdTenants.length) await db.delete(tenants).where(inArray(tenants.id, createdTenants))
  await f.cleanup()
  await db.$client.end()
})

describe('meta e pontuação padrão de cada tenant', () => {
  it('tenant criado por createTenantFor nasce com a meta de 100 pontos em dias úteis e a pontuação de fábrica', async () => {
    const admin = await addAdmin(f)
    const tenant = await createTenantFor({ ...admin, role: 'SUPER_ADMIN' }, { name: 'Com padrões', slug: `padroes-${f.tenant.slug}`, timezone: 'America/Sao_Paulo' })
    createdTenants.push(tenant.id)

    expect(await goalsOf(tenant.id)).toMatchObject([{ name: 'Padrão', isDefault: true, targetPoints: 100, activeDays: [...BUSINESS_DAYS] }])
    expect(await rulesOf(tenant.id)).toMatchObject([{ name: 'Padrão', isDefault: true, ...FACTORY_RULES }])
  })

  it('o tenant do fixture nasce igual, e o fixture devolve os dois padrões', async () => {
    expect(await goalsOf(f.tenant.id)).toMatchObject([{ id: f.goal.id, isDefault: true }])
    expect(await rulesOf(f.tenant.id)).toMatchObject([{ id: f.scoringRule.id, isDefault: true }])
  })
})

describe('sem padrão o resolvedor falha alto', () => {
  let bare: { id: string; slug: string }
  let team: { id: string }

  beforeAll(async () => {
    const [tenant] = await db.insert(tenants).values({ name: 'Sem padrão', slug: `bare-${f.tenant.slug}` }).returning()
    bare = tenant!
    createdTenants.push(bare.id)
    team = await addTeam({ tenant: bare })
  })

  it('a pontuação efetiva da equipe', async () => {
    await expect(snapshotOfTeam(db, bare.id, team.id)).rejects.toThrow('O tenant não tem pontuação padrão')
  })

  it('as metas efetivas da pessoa, com ou sem equipe', async () => {
    const inTeam = await addUser({ tenant: bare }, { role: 'MEMBER', team })
    const teamless = await addUser({ tenant: bare }, { role: 'MEMBER', team: null })

    await expect(effectiveGoalsOf(db, inTeam.userId)).rejects.toThrow('O tenant não tem meta padrão')
    await expect(effectiveGoalsOf(db, teamless.userId)).rejects.toThrow('O tenant não tem meta padrão')
  })
})
