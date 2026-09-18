import { Link, createFileRoute } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { ChallengeCard } from '#/components/ChallengeCard'
import { listChallenges } from '#/server/challenges'

export const Route = createFileRoute('/_app/challenges/')({
  loader: () => listChallenges(),
  component: Challenges,
})

function Challenges() {
  const list = Route.useLoaderData()
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Desafios</h1>
        <Link to="/challenges/new" className="btn-primary px-3 py-2 text-xs"><Plus className="h-4 w-4" /> Desafio</Link>
      </div>
      <p className="text-sm text-neutral-500">Atividades repetíveis. Bata o recorde da equipe.</p>
      {list.length === 0 && <p className="card text-center text-sm text-neutral-500">Nenhum desafio ainda. Crie o primeiro.</p>}
      <ul className="space-y-2">
        {list.map((c) => <li key={c.id}><ChallengeCard c={c} /></li>)}
      </ul>
    </div>
  )
}
