import { useRouter } from '@tanstack/react-router'
import { Save } from 'lucide-react'
import * as React from 'react'
import { useAttempt } from '#/components/useAttempt'
import type { getTenantSettings } from '#/server/tenant-settings'
import { updateTenantSettings } from '#/server/tenant-settings'

type General = Awaited<ReturnType<typeof getTenantSettings>>

export function GeneralTab({ settings, timeZones }: General) {
  const router = useRouter()
  const [saved, setSaved] = React.useState(false)
  const { error, attempt } = useAttempt()
  const zoneOptions = timeZones.includes(settings.timezone) ? timeZones : [settings.timezone, ...timeZones]

  async function save(form: HTMLFormElement) {
    const f = new FormData(form)
    await attempt(async () => {
      await updateTenantSettings({ data: { timezone: String(f.get('timezone')), requireTwoFactor: f.get('requireTwoFactor') === 'on' } })
      await router.invalidate()
      setSaved(true)
    })
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        setSaved(false)
        save(e.currentTarget)
      }}
      onChange={() => setSaved(false)}
      className="card max-w-xl space-y-4"
    >
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
      {error && <p role="alert" className="text-sm text-rose-400">{error}</p>}
      {saved && <p className="text-sm text-xp-400" role="status">Configurações salvas.</p>}
      <button className="btn-primary"><Save className="h-4 w-4" /> Salvar</button>
    </form>
  )
}
