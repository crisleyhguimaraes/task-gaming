import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import * as React from 'react'
import { createTenant, listTenants } from '#/server/tenants'

export const Route = createFileRoute('/_app/admin/tenants/')({
  staticData: { pageWidth: 'wide' },
  loader: () => listTenants(),
  component: Tenants,
})

function Tenants() {
  const list = Route.useLoaderData()
  const router = useRouter()
  const [error, setError] = React.useState<string | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    try {
      await createTenant({
        data: {
          name: String(f.get('name')),
          slug: String(f.get('slug')),
          timezone: String(f.get('timezone')),
        },
      })
      e.currentTarget.reset()
      setError(null)
      router.invalidate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar')
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Tenants</h1>

      <form onSubmit={onSubmit} className="card grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
        <div className="space-y-1">
          <label htmlFor="name">Nome</label>
          <input id="name" name="name" required minLength={2} />
        </div>
        <div className="space-y-1">
          <label htmlFor="slug">Slug</label>
          <input id="slug" name="slug" required pattern="[a-z0-9-]{2,60}" placeholder="acme" />
        </div>
        <div className="space-y-1">
          <label htmlFor="timezone">Fuso</label>
          <input id="timezone" name="timezone" defaultValue="America/Sao_Paulo" required />
        </div>
        <button className="btn-primary self-end">
          <Plus className="h-4 w-4" /> Criar
        </button>
        {error && <p className="text-sm text-rose-400 sm:col-span-4">{error}</p>}
      </form>

      <ul className="divide-y divide-neutral-800 rounded-2xl border border-neutral-800">
        {list.map((t) => (
          <li key={t.id}>
            <Link
              to="/admin/tenants/$tenantId"
              params={{ tenantId: t.id }}
              className="flex items-center justify-between px-4 py-3 hover:bg-neutral-900"
            >
              <div>
                <div className="font-medium">{t.name}</div>
                <div className="text-xs text-neutral-500">
                  {t.slug} · {t.timezone}
                </div>
              </div>
              <span className="text-xs text-neutral-500">{t.userCount} usuários</span>
            </Link>
          </li>
        ))}
        {list.length === 0 && <li className="px-4 py-6 text-center text-sm text-neutral-500">Nenhum tenant ainda.</li>}
      </ul>
    </div>
  )
}
