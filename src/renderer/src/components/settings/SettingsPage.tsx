import { useStore } from '@/store'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Dropdown } from '@/components/ui/Dropdown'
import { LoginForm } from '@/components/auth/LoginForm'
import { PlaylistImport } from '@/components/auth/PlaylistImport'
import { SourceManager } from '@/components/auth/SourceManager'

export function SettingsContent() {
  const { settings, updateSettings, resetSettings } = useStore()

  return (
    <div className="flex flex-col gap-8 max-w-3xl">
      {/* Sources */}
      <section>
        <h2 className="text-lg font-semibold mb-4">Sources</h2>
        <SourceManager />
        <div className="grid gap-6 mt-6 md:grid-cols-2">
          <div className="rounded-xl border border-surface-800 bg-surface-900 p-5">
            <LoginForm />
          </div>
          <div className="rounded-xl border border-surface-800 bg-surface-900 p-5">
            <PlaylistImport />
          </div>
        </div>
      </section>

      {/* General Settings */}
      <section>
        <h2 className="text-lg font-semibold mb-4">General</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Dropdown
            items={[
              { id: 'grid', label: 'Grid View' },
              { id: 'list', label: 'List View' }
            ]}
            value={settings.channelViewMode}
            onSelect={(id) => updateSettings({ channelViewMode: id as 'grid' | 'list' })}
            placeholder="Channel view mode"
          />
          <Dropdown
            items={[
              { id: '24h', label: '24 Hour' },
              { id: '12h', label: '12 Hour' }
            ]}
            value={settings.epgTimeFormat}
            onSelect={(id) => updateSettings({ epgTimeFormat: id as '12h' | '24h' })}
            placeholder="Time format"
          />
        </div>
      </section>

      {/* Player Settings */}
      <section>
        <h2 className="text-lg font-semibold mb-4">Player</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="text-sm text-surface-400 mb-1 block">Default Volume</label>
            <input
              type="range"
              min={0} max={1} step={0.05}
              value={settings.defaultVolume}
              onChange={(e) => updateSettings({ defaultVolume: parseFloat(e.target.value) })}
              className="w-full"
            />
            <span className="text-xs text-surface-500">{Math.round(settings.defaultVolume * 100)}%</span>
          </div>
          <div>
            <label className="text-sm text-surface-400 mb-1 block">Subtitle Font Size</label>
            <input
              type="range"
              min={16} max={48} step={2}
              value={settings.subtitleFontSize}
              onChange={(e) => updateSettings({ subtitleFontSize: parseInt(e.target.value) })}
              className="w-full"
            />
            <span className="text-xs text-surface-500">{settings.subtitleFontSize}px</span>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.autoPlay}
              onChange={(e) => updateSettings({ autoPlay: e.target.checked })}
              className="rounded border-surface-600 bg-surface-800 text-accent focus:ring-accent"
            />
            <span className="text-sm text-surface-300">Auto-play on channel select</span>
          </label>
        </div>
      </section>

      {/* EPG Settings */}
      <section>
        <h2 className="text-lg font-semibold mb-4">EPG</h2>
        <Input
          id="epg-refresh"
          label="EPG Refresh Interval (minutes)"
          type="number"
          value={settings.epgRefreshInterval}
          onChange={(e) => updateSettings({ epgRefreshInterval: parseInt(e.target.value) || 60 })}
        />
      </section>

      <div className="border-t border-surface-800 pt-6">
        <Button variant="danger" onClick={resetSettings}>
          Reset All Settings
        </Button>
      </div>
    </div>
  )
}
