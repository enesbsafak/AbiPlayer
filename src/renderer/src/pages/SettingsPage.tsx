import { SettingsContent } from '@/components/settings/SettingsPage'
import { strings } from '@/strings'

export default function SettingsPage() {
  return (
    <div className="p-6">
      <h1 className="text-xl font-bold mb-6">{strings.settings.title}</h1>
      <SettingsContent />
    </div>
  )
}
