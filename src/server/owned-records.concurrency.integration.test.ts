import { and, asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { leads, opportunities, pipelineStages, teamMembers, users } from '#/db/schema'
import { importLeadsFor } from './leads-import.core'
import { claimLeadFor, releaseOwnedRecords } from './leads.core'
import { convertLeadFor, createOpportunityFor, moveOpportunityFor } from './pipeline.core'
import type { AuthCtx } from './roles'
import { removeTeamMemberFor } from './team-members.core'
import { addLead, addOpportunity } from './test-crm-fixtures'
import { addAdmin, addTeam, addUser, makeTenant } from './test-fixtures'
import type { Tx } from './tx'
import { deactivateUserCore } from './users.core'

let f: Awaited<ReturnType<typeof makeTenant>>
let admin: AuthCtx

const LOCK_PROBE_MS = 200
const ROUNDS = 6
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const deal = { title: 'Negócio', amountCents: 1000 }

const newMember = () => addUser(f, { role: 'MEMBER', team: f.team })
const outcome = (attempt: Promise<unknown>) => attempt.then(() => 'ok', (error: Error) => error.message)

const ownerOfLead = async (id: string) => (await db.select().from(leads).where(eq(leads.id, id)))[0]!.ownerId
const ownersOfOpportunities = async (leadId: string) => (await db.select().from(opportunities).where(eq(opportunities.leadId, leadId))).map((o) => o.ownerId)

const dropMembership = (tx: Tx, userId: string, teamId = f.team.id) => tx.delete(teamMembers).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
const ban = (tx: Tx, userId: string) => tx.update(users).set({ banned: true }).where(eq(users.id, userId))

const firstOpenStageId = async () =>
  (await db.select().from(pipelineStages).where(and(eq(pipelineStages.pipelineId, f.pipeline.id), eq(pipelineStages.kind, 'open'))).orderBy(asc(pipelineStages.sortOrder)))[0]!.id

/** Abre a saída (`begin`) e a segura sem commit enquanto `attempt` corre; devolve o desfecho de `attempt`. */
async function whileExiting(begin: (tx: Tx) => Promise<unknown>, userId: string, attempt: () => Promise<unknown>) {
  let attempted = Promise.resolve('')
  await db.transaction(async (tx) => {
    await begin(tx)
    attempted = outcome(attempt())
    await wait(LOCK_PROBE_MS)
    await releaseOwnedRecords(tx, userId)
  })
  return attempted
}

beforeAll(async () => {
  f = await makeTenant(0)
  admin = await addAdmin(f)
})
afterAll(async () => {
  await f.cleanup()
  await db.$client.end()
})

describe('converter lead × saída do dono', () => {
  it('converter o lead de quem está saindo da equipe, com a saída aberta, termina sem impasse e a oportunidade sai sem dono', async () => {
    const leaving = await newMember()
    const lead = await addLead(f, f.team.id, leaving.userId)

    const converted = await whileExiting((tx) => dropMembership(tx, leaving.userId), leaving.userId, () => convertLeadFor(f.leader, lead.id, deal))

    expect(converted).toBe('ok')
    expect(await ownerOfLead(lead.id)).toBeNull()
    expect(await ownersOfOpportunities(lead.id)).toEqual([null])
  })

  it('criar oportunidade para o dono do lead que está saindo da equipe termina sem impasse e a oportunidade sai sem dono', async () => {
    const leaving = await newMember()
    const lead = await addLead(f, f.team.id, leaving.userId)

    const created = await whileExiting((tx) => dropMembership(tx, leaving.userId), leaving.userId, () => createOpportunityFor(f.leader, lead.id, { ...deal, ownerId: leaving.userId }))

    expect(created).toBe('ok')
    expect(await ownersOfOpportunities(lead.id)).toEqual([null])
  })

  it('converter o lead de quem está sendo desativado, com a desativação aberta, termina sem impasse e a oportunidade sai sem dono', async () => {
    const leaving = await newMember()
    const lead = await addLead(f, f.team.id, leaving.userId)

    const converted = await whileExiting((tx) => ban(tx, leaving.userId), leaving.userId, () => convertLeadFor(f.leader, lead.id, deal))

    expect(converted).toBe('ok')
    expect(await ownersOfOpportunities(lead.id)).toEqual([null])
  })

  it('a saída espera o lead travado por quem cria a oportunidade e libera a oportunidade criada nesse meio-tempo', async () => {
    const leaving = await newMember()
    const lead = await addLead(f, f.team.id, leaving.userId)
    const stageId = await firstOpenStageId()
    let leaves = Promise.resolve('')

    await db.transaction(async (tx) => {
      await tx.select().from(leads).where(eq(leads.id, lead.id)).for('update')
      await tx.insert(opportunities).values({ tenantId: f.tenant.id, teamId: f.team.id, leadId: lead.id, ownerId: leaving.userId, title: 'Negócio', pipelineId: f.pipeline.id, stageId })
      leaves = outcome(removeTeamMemberFor(admin, { userId: leaving.userId, teamId: f.team.id }))
      await wait(LOCK_PROBE_MS)
    })

    expect(await leaves).toBe('ok')
    expect(await ownersOfOpportunities(lead.id)).toEqual([null])
  })

  it('converter e o dono sair ao mesmo tempo nunca dá impasse e nunca deixa a oportunidade com o ex-membro', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const leaving = await newMember()
      const lead = await addLead(f, f.team.id, leaving.userId)

      const results = await Promise.allSettled([convertLeadFor(f.leader, lead.id, deal), removeTeamMemberFor(admin, { userId: leaving.userId, teamId: f.team.id })])

      expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled'])
      expect(await ownerOfLead(lead.id)).toBeNull()
      expect(await ownersOfOpportunities(lead.id)).toEqual([null])
    }
  })

  it('converter e o dono ser desativado ao mesmo tempo nunca dá impasse e nunca deixa a oportunidade com o desativado', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const leaving = await newMember()
      const lead = await addLead(f, f.team.id, leaving.userId)

      const results = await Promise.allSettled([convertLeadFor(f.leader, lead.id, deal), deactivateUserCore(admin, leaving.userId)])

      expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled'])
      expect(await ownerOfLead(lead.id)).toBeNull()
      expect(await ownersOfOpportunities(lead.id)).toEqual([null])
    }
  })
})

describe('reabrir oportunidade fechada × saída do dono', () => {
  const closedDealOf = async (ownerId: string) => addOpportunity(f, await addLead(f, f.team.id), ownerId, 'won')
  const ownerOfOpportunity = async (id: string) => (await db.select().from(opportunities).where(eq(opportunities.id, id)))[0]!.ownerId

  it('reabrir com a saída do dono aberta termina sem impasse e a oportunidade aberta fica sem dono', async () => {
    const leaving = await newMember()
    const won = await closedDealOf(leaving.userId)

    const reopened = await whileExiting((tx) => dropMembership(tx, leaving.userId), leaving.userId, async () => moveOpportunityFor(f.leader, won.id, await firstOpenStageId()))

    expect(reopened).toBe('ok')
    expect(await ownerOfOpportunity(won.id)).toBeNull()
  })

  it('reabrir e o dono sair ao mesmo tempo nunca dá impasse e nunca deixa a oportunidade aberta com o ex-membro', async () => {
    const openStageId = await firstOpenStageId()
    for (let round = 0; round < ROUNDS; round++) {
      const leaving = await newMember()
      const won = await closedDealOf(leaving.userId)

      const results = await Promise.allSettled([moveOpportunityFor(f.leader, won.id, openStageId), removeTeamMemberFor(admin, { userId: leaving.userId, teamId: f.team.id })])

      expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled'])
      expect(await ownerOfOpportunity(won.id)).toBeNull()
    }
  })
})

describe('importar com "menos carregado" × saída do membro', () => {
  async function teamWithOneMember() {
    const team = await addTeam(f)
    const member = await addUser(f, { role: 'MEMBER', team })
    return { team, member }
  }

  const importOne = (teamId: string) => importLeadsFor(admin, { teamId, rows: [{ name: 'Importada' }], onDuplicate: 'skip', distribute: 'least_loaded' })
  const importedOwners = async (teamId: string) => (await db.select().from(leads).where(eq(leads.teamId, teamId))).map((l) => l.ownerId)

  it('com a saída do único membro aberta, o lead importado espera a saída e vai para o pool', async () => {
    const { team, member } = await teamWithOneMember()
    let importing: Promise<unknown> = Promise.resolve()

    await db.transaction(async (tx) => {
      await dropMembership(tx, member.userId, team.id)
      await releaseOwnedRecords(tx, member.userId, team.id)
      importing = importOne(team.id)
      await wait(LOCK_PROBE_MS)
    })

    expect(await importing).toMatchObject({ created: 1 })
    expect(await importedOwners(team.id)).toEqual([null])
  })

  it('importar e o único membro sair ao mesmo tempo nunca deixa lead com o ex-membro', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const { team, member } = await teamWithOneMember()

      const results = await Promise.allSettled([importOne(team.id), removeTeamMemberFor(admin, { userId: member.userId, teamId: team.id })])

      expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled'])
      expect(await importedOwners(team.id)).toEqual([null])
    }
  })
})

describe('assumir lead do pool × saída de quem assume', () => {
  it('com o contexto carregado antes da saída, assumir é recusado e o lead continua no pool', async () => {
    const leaver = await newMember()
    const lead = await addLead(f, f.team.id)
    await removeTeamMemberFor(admin, { userId: leaver.userId, teamId: f.team.id })

    await expect(claimLeadFor(leaver, lead.id)).rejects.toThrow('Lead indisponível')

    expect(await ownerOfLead(lead.id)).toBeNull()
  })

  it('com a saída aberta, assumir espera a saída, é recusado e o lead não fica com o ex-membro', async () => {
    const leaver = await newMember()
    const lead = await addLead(f, f.team.id)
    let claiming = Promise.resolve('')

    await db.transaction(async (tx) => {
      await dropMembership(tx, leaver.userId)
      await releaseOwnedRecords(tx, leaver.userId, f.team.id)
      claiming = outcome(claimLeadFor(leaver, lead.id))
      await wait(LOCK_PROBE_MS)
    })

    expect(await claiming).toContain('Lead indisponível')
    expect(await ownerOfLead(lead.id)).toBeNull()
  })

  it('assumir e sair ao mesmo tempo nunca deixa o lead com o ex-membro', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const leaver = await newMember()
      const lead = await addLead(f, f.team.id)

      const [, left] = await Promise.allSettled([claimLeadFor(leaver, lead.id), removeTeamMemberFor(admin, { userId: leaver.userId, teamId: f.team.id })])

      expect(left.status).toBe('fulfilled')
      expect(await ownerOfLead(lead.id)).toBeNull()
    }
  })

  it('assumir com o contexto de quem foi desativado é recusado', async () => {
    const deactivated = await newMember()
    const lead = await addLead(f, f.team.id)
    await deactivateUserCore(admin, deactivated.userId)

    await expect(claimLeadFor(deactivated, lead.id)).rejects.toThrow('Lead indisponível')

    expect(await ownerOfLead(lead.id)).toBeNull()
  })
})
