import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#/db'
import { archivePipelineFor, createPipelineFor, linkTeamToPipelineFor, listPipelinesWithTeamsFor, pipelinesOfTeamFor } from './pipelines.core'
import type { AuthCtx } from './roles'
import { addAdmin, addTeam, addUser, makeTenant } from './test-fixtures'

type Fixture = Awaited<ReturnType<typeof makeTenant>>

let f: Fixture
let other: Fixture
let admin: AuthCtx
let otherAdmin: AuthCtx
let teamB: { id: string; name: string }

let sequence = 0
const uniqueName = (label: string) => `${label} ${++sequence}`

beforeAll(async () => {
  f = await makeTenant(1)
  other = await makeTenant(0)
  admin = await addAdmin(f)
  otherAdmin = await addAdmin(other)
  teamB = await addTeam(f, 'Equipe B')
})
afterAll(async () => {
  await f.cleanup()
  await other.cleanup()
  await db.$client.end()
})

describe('listPipelinesWithTeamsFor', () => {
  it('admin vê cada pipeline com as equipes vinculadas, em ordem de nome', async () => {
    const created = await createPipelineFor(admin, uniqueName('Parcerias'))
    await linkTeamToPipelineFor(admin, created.id, teamB.id)
    await linkTeamToPipelineFor(admin, created.id, f.team.id)

    const list = await listPipelinesWithTeamsFor(admin)

    expect(list.find((p) => p.id === created.id)).toMatchObject({ name: created.name, isDefault: false, archivedAt: null, teams: [{ id: teamB.id, name: 'Equipe B' }, { id: f.team.id, name: 'Time' }] })
    expect(list.find((p) => p.id === f.pipeline.id)).toMatchObject({ isDefault: true, teams: [] })
  })

  it('os demais veem só os pipelines efetivos das equipes que integram', async () => {
    const mine = await createPipelineFor(admin, uniqueName('Da equipe'))
    const theirs = await createPipelineFor(admin, uniqueName('Da outra'))
    await linkTeamToPipelineFor(admin, mine.id, f.team.id)
    await linkTeamToPipelineFor(admin, theirs.id, teamB.id)

    const ids = (await listPipelinesWithTeamsFor(f.members[0]!)).map((p) => p.id)

    expect(ids).toContain(mine.id)
    expect(ids).not.toContain(theirs.id)
  })

  it('não traz pipeline nem equipe de outro tenant', async () => {
    const theirs = await createPipelineFor(otherAdmin, uniqueName('Deles'))

    expect((await listPipelinesWithTeamsFor(admin)).some((p) => p.id === theirs.id)).toBe(false)
  })
})

describe('pipelinesOfTeamFor', () => {
  it('equipe sem vínculo usa o padrão do tenant', async () => {
    const team = await addTeam(f)

    expect(await pipelinesOfTeamFor(admin, team.id)).toEqual([{ id: f.pipeline.id, name: f.pipeline.name }])
  })

  it('vínculo explícito substitui o padrão, e o arquivado não aparece', async () => {
    const team = await addTeam(f)
    const [first, second, archived] = [await createPipelineFor(admin, uniqueName('Funil')), await createPipelineFor(admin, uniqueName('Funil')), await createPipelineFor(admin, uniqueName('Funil'))]
    for (const pipeline of [first, second, archived]) await linkTeamToPipelineFor(admin, pipeline.id, team.id)
    await archivePipelineFor(admin, archived.id)

    const options = await pipelinesOfTeamFor(admin, team.id)

    expect(options.map((p) => p.id).sort()).toEqual([first.id, second.id].sort())
  })

  it('quem não integra a equipe e a equipe de outro tenant são "não encontradas"', async () => {
    const outsider = await addUser(f, { role: 'MEMBER', team: f.team })

    await expect(pipelinesOfTeamFor(outsider, teamB.id)).rejects.toThrow('Equipe não encontrada')
    await expect(pipelinesOfTeamFor(otherAdmin, teamB.id)).rejects.toThrow('Equipe não encontrada')
  })
})
