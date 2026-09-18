import { getRouteApi } from '@tanstack/react-router'

/** Acesso ao contexto do layout autenticado ({ me, active }) sem importar o arquivo de rota. */
export const appRoute = getRouteApi('/_app')
