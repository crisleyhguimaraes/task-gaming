import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { ArrowLeft, LogIn, UserPlus } from 'lucide-react'
import * as React from 'react'
import { authClient } from '#/lib/auth-client'
import { createTenantAdmin, getTenant } from '#/server/tenants'

export const Route = createFileRoute('/_app/admin/tenants/$tenantId')({
  staticData: { pageWidth: 'narrow' },
  loader: ({ params }) => getTenant({ data: { tenantId: params.tenantId } }),
  component: TenantDetail,
})

function TenantDetail() {
  const { tenant, members } = Route.useLoaderData()
  const router = useRouter()
  const [error, setError] = React.useState<string | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const f = new FormData(form)
    try {
      await createTenantAdmin({
        data: {
          tenantId: tenant.id,
          name: String(f.get('name')),
          email: String(f.get('email')),
          password: String(f.get('password')),
        },
      })
      form.reset()
      setError(null)
      router.invalidate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar')
    }
  }

  async function impersonate(userId: string) {
    const res = await authClient.admin.impersonateUser({ userId })
    if (res.error) return setError(res.error.message ?? 'Erro ao entrar como')
    await router.invalidate()
    router.navigate({ to: '/' })
  }

  return (
    <div className="space-y-6">
      <Link to="/admin/tenants" className="inline-flex items-center gap-1 text-sm text-neutral-400 hover:text-neutral-50">
        <ArrowLeft className="h-4 w-4" /> Tenants
      </Link>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{tenant.name}</h1>
        <p className="text-xs text-neutral-500">{tenant.slug} · {tenant.timezone}</p>
      </div>

      <form onSubmit={onSubmit} className="card space-y-3">
        <h2 className="text-sm font-semibold text-neutral-300">Criar admin do tenant</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <label htmlFor="name">Nome</label>
            <input id="name" name="name" required minLength={2} />
          </div>
          <div className="space-y-1">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" required />
          </div>
          <div className="space-y-1">
            <label htmlFor="password">Senha temporária</label>
            <input id="password" name="password" type="text" required minLength={8} autoComplete="off" />
          </div>
        </div>
        {error && <p className="text-sm text-rose-400">{error}</p>}
        <button className="btn-primary">
          <UserPlus className="h-4 w-4" /> Criar admin
        </button>
      </form>

      <ul className="divide-y divide-neutral-800 rounded-2xl border border-neutral-800">
        {members.map((u) => (
          <li key={u.id} className="flex items-center justify-between px-4 py-3">
            <div>
              <div className="font-medium">{u.name}</div>
              <div className="text-xs text-neutral-500">
                {u.email} · {u.role}
                {u.teams.length > 0 ? ` · ${u.teams.join(', ')}` : ''}
              </div>
            </div>
            {u.role !== 'SUPER_ADMIN' && (
              <button onClick={() => impersonate(u.id)} className="btn-ghost px-3 py-1.5 text-xs">
                <LogIn className="h-3.5 w-3.5" /> Entrar como
              </button>
            )}
          </li>
        ))}
        {members.length === 0 && <li className="px-4 py-6 text-center text-sm text-neutral-500">Nenhum usuário ainda.</li>}
      </ul>
    </div>
  )
}
