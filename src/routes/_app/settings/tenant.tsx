import { createFileRoute, useRouter } from '@tanstack/react-router'
import { Save } from 'lucide-react'
import * as React from 'react'
import { MAX_DAILY_GOAL, MIN_DAILY_GOAL } from '#/lib/tenant-settings'
import { getTenantSettings, updateTenantSettings } from '#/server/tenant-settings'

export const Route = createFileRoute('/_app/settings/tenant')({
  loader: () => getTenantSettings(),
  component: TenantSettings,
})

function TenantSettings() {
  const { settings, timeZones } = Route.useLoaderData()
  const zoneOptions = timeZones.includes(settings.timezone) ? timeZones : [settings.timezone, ...timeZones]
  const router = useRouter()
  const [error, setError] = React.useState<string | null>(null)
  const [saved, setSaved] = React.useState(false)

  async function save(form: HTMLFormElement) {
    const f = new FormData(form)
    try {
      await updateTenantSettings({
        data: { dailyGoalPoints: Number(f.get('dailyGoalPoints')), timezone: String(f.get('timezone')), requireTwoFactor: f.get('requireTwoFactor') === 'on' },
      })
      setError(null)
      setSaved(true)
      router.invalidate()
    } catch (e) {
      setSaved(false)
      setError(e instanceof Error ? e.message : 'Erro')
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-neutral-400">Configurações</p>
        <h1 className="text-2xl font-bold tracking-tight">Organização</h1>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          save(e.currentTarget)
        }}
        onChange={() => setSaved(false)}
        className="card max-w-xl space-y-4"
      >
        <div className="space-y-1">
          <label htmlFor="dailyGoalPoints">Meta diária de pontos</label>
          <input id="dailyGoalPoints" name="dailyGoalPoints" type="number" required min={MIN_DAILY_GOAL} max={MAX_DAILY_GOAL} step={1} defaultValue={settings.dailyGoalPoints} />
          <p className="text-xs text-neutral-500">Alimenta o anel da tela Hoje. Entre {MIN_DAILY_GOAL} e {MAX_DAILY_GOAL}.</p>
        </div>
        <div className="space-y-1">
          <label htmlFor="timezone">Fuso horário</label>
          <select id="timezone" name="timezone" defaultValue={settings.timezone}>
            {zoneOptions.map((zone) => (
              <option key={zone} value={zone}>{zone}</option>
            ))}
          </select>
          <p className="text-xs text-neutral-500">Define onde o dia começa e termina para sequência e meta diária.</p>
        </div>
        <label className="flex items-start gap-3 text-sm text-neutral-200">
          <input name="requireTwoFactor" type="checkbox" defaultChecked={settings.requireTwoFactor} className="mt-0.5 h-4 w-4 p-0 accent-xp-400" />
          <span>
            Exigir verificação em duas etapas
            <span className="block text-xs font-normal text-neutral-500">Quem ainda não ativou será levado a cadastrar o 2FA no próximo acesso.</span>
          </span>
        </label>
        {error && <p className="text-sm text-rose-400">{error}</p>}
        {saved && <p className="text-sm text-xp-400" role="status">Configurações salvas.</p>}
        <button className="btn-primary"><Save className="h-4 w-4" /> Salvar</button>
      </form>
    </div>
  )
}
