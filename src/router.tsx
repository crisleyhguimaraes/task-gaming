import { Link, createRouter as createTanStackRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  return createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    defaultErrorComponent: ({ error }) => (
      <main className="mx-auto max-w-md px-4 py-16">
        <div className="card space-y-3 text-center">
          <p className="text-lg font-semibold">Algo deu errado</p>
          <p className="text-sm text-neutral-400">{error instanceof Error ? error.message : String(error)}</p>
          <Link to="/" className="btn-ghost">Voltar para Hoje</Link>
        </div>
      </main>
    ),
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
