import { Link, createFileRoute } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { ChallengeCard } from '#/components/ChallengeCard'
import { PageHeader } from '#/components/PageHeader'
import { listChallenges } from '#/server/challenges'

export const Route = createFileRoute('/_app/challenges/')({
  staticData: { pageWidth: 'wide' },
  loader: () => listChallenges(),
  component: Challenges,
})

function Challenges() {
  const list = Route.useLoaderData()
  return (
    <div>
      <PageHeader title="Desafios" subtitle="Atividades repetíveis. Bata o recorde e faça sua equipe subir no ranking.">
        <Link to="/challenges/new" className="btn-primary px-3 py-2 text-xs"><Plus className="h-4 w-4" /> Novo desafio</Link>
      </PageHeader>
      {list.length === 0 && <p className="card text-center text-sm text-neutral-500">Nenhum desafio ainda. Crie o primeiro.</p>}
      <ul className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {list.map((c) => <li key={c.id}><ChallengeCard c={c} /></li>)}
      </ul>
    </div>
  )
}
