import { useMemo } from 'react'
import { useStore } from '@/store'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Dropdown } from '@/components/ui/Dropdown'
import { LoginForm } from '@/components/auth/LoginForm'
import { PlaylistImport } from '@/components/auth/PlaylistImport'
import { SourceManager } from '@/components/auth/SourceManager'
import { collectTrackLanguages } from '@/services/track-preferences'

const COMMON_LANGUAGE_CODES = ['tr', 'en', 'de', 'fr', 'es', 'it', 'pt', 'ru', 'ar']

function parseSubtitleBackgroundOpacity(background: string): number {
  const match = background.match(
    /rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*([0-9]*\.?[0-9]+)\s*)?\)/i
  )
  if (!match) return 75
  const alpha = match[1] ? Number.parseFloat(match[1]) : 1
  if (!Number.isFinite(alpha)) return 75
  return Math.round(Math.max(0, Math.min(1, alpha)) * 100)
}

function formatLanguageLabel(code: string): string {
  const normalized = code.trim().toLowerCase()
  if (!normalized) return 'Bilinmiyor'

  try {
    const languagePart = normalized.split('-')[0]
    const displayNames = new Intl.DisplayNames(['tr'], { type: 'language' })
    const display = displayNames.of(languagePart)
    return display ? `${display} (${normalized.toUpperCase()})` : normalized.toUpperCase()
  } catch {
    return normalized.toUpperCase()
  }
}

export function SettingsContent() {
  const {
    settings,
    audioTracks,
    subtitleTracks,
    currentAudioTrack,
    currentSubtitleTrack,
    updateSettings,
    resetSettings,
    setCurrentAudioTrack,
    setCurrentSubtitleTrack,
    setSubtitleCues,
    setActiveSubtitleCues
  } = useStore()

  const subtitleOpacity = parseSubtitleBackgroundOpacity(settings.subtitleBackground)
  const languageCodes = useMemo(() => {
    const trackLanguages = collectTrackLanguages([...audioTracks, ...subtitleTracks])
    const merged = [...trackLanguages, ...COMMON_LANGUAGE_CODES]
    return Array.from(new Set(merged))
  }, [audioTracks, subtitleTracks])

  const audioLanguageItems = useMemo(
    () => [
      { id: 'auto', label: 'Otomatik (yayin varsayilani)' },
      ...languageCodes.map((code) => ({ id: code, label: formatLanguageLabel(code) }))
    ],
    [languageCodes]
  )

  const subtitleLanguageItems = useMemo(
    () => [
      { id: 'off', label: 'Varsayilan kapali' },
      { id: 'auto', label: 'Otomatik (ilk uygun)' },
      ...languageCodes.map((code) => ({ id: code, label: formatLanguageLabel(code) }))
    ],
    [languageCodes]
  )

  const subtitlePreferenceValue = settings.defaultSubtitleEnabled
    ? settings.preferredSubtitleLanguage
    : 'off'

  return (
    <div className="flex flex-col gap-8 max-w-3xl">
      {/* Sources */}
      <section>
        <h2 className="text-lg font-semibold mb-4">Kaynaklar</h2>
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
        <h2 className="text-lg font-semibold mb-4">Genel</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Dropdown
            items={[
              { id: 'grid', label: 'Izgara Gorunumu' },
              { id: 'list', label: 'Liste Gorunumu' }
            ]}
            value={settings.channelViewMode}
            onSelect={(id) => updateSettings({ channelViewMode: id as 'grid' | 'list' })}
            placeholder="Kanal gorunum modu"
          />
          <Dropdown
            items={[
              { id: '24h', label: '24 Saat' },
              { id: '12h', label: '12 Saat' }
            ]}
            value={settings.epgTimeFormat}
            onSelect={(id) => updateSettings({ epgTimeFormat: id as '12h' | '24h' })}
            placeholder="Saat formati"
          />
        </div>
      </section>

      {/* Player Settings */}
      <section>
        <h2 className="text-lg font-semibold mb-4">Oynatici</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="text-sm text-surface-400 mb-1 block">Varsayilan Ses Seviyesi</label>
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
            <label className="text-sm text-surface-400 mb-1 block">Altyazi Yazi Boyutu</label>
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

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <label className="text-sm text-surface-400 mb-1 block">Altyazi Rengi</label>
            <input
              type="color"
              value={settings.subtitleColor}
              onChange={(e) => updateSettings({ subtitleColor: e.target.value })}
              className="h-10 w-full cursor-pointer rounded-lg border border-surface-600 bg-surface-800 px-2"
            />
          </div>
          <div>
            <label className="text-sm text-surface-400 mb-1 block">Altyazi Arka Plan Opakligi</label>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={subtitleOpacity}
              onChange={(e) => {
                const opacity = Number.parseInt(e.target.value, 10)
                const alpha = Math.max(0, Math.min(100, opacity)) / 100
                updateSettings({ subtitleBackground: `rgba(0,0,0,${alpha.toFixed(2)})` })
              }}
              className="w-full"
            />
            <span className="text-xs text-surface-500">{subtitleOpacity}%</span>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-surface-700 bg-surface-900/70 p-4">
          <p className="text-xs font-medium text-surface-500">Altyazı Önizleme</p>
          <div className="mt-3 rounded-lg border border-surface-800 bg-black/70 p-6 text-center">
            <span
              className="inline-block rounded px-3 py-1 leading-relaxed"
              style={{
                fontSize: `${settings.subtitleFontSize}px`,
                color: settings.subtitleColor,
                backgroundColor: settings.subtitleBackground
              }}
            >
              Bu bir altyazi onizlemesidir.
            </span>
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <label className="text-sm text-surface-400 mb-2 block">Tercih Edilen Dublaj Dili</label>
            <Dropdown
              items={audioLanguageItems}
              value={settings.preferredAudioLanguage}
              onSelect={(id) => updateSettings({ preferredAudioLanguage: id })}
              placeholder="Tercih edilen dublaj dili"
            />
          </div>
          <div>
            <label className="text-sm text-surface-400 mb-2 block">Tercih Edilen Altyazi Dili</label>
            <Dropdown
              items={subtitleLanguageItems}
              value={subtitlePreferenceValue}
              onSelect={(id) => {
                if (id === 'off') {
                  updateSettings({ defaultSubtitleEnabled: false, preferredSubtitleLanguage: 'auto' })
                } else {
                  updateSettings({ defaultSubtitleEnabled: true, preferredSubtitleLanguage: id })
                }
              }}
              placeholder="Tercih edilen altyazi dili"
            />
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <label className="text-sm text-surface-400 mb-2 block">Aktif Yayin Dublaji</label>
            {audioTracks.length > 0 ? (
              <Dropdown
                items={audioTracks.map((track, index) => ({
                  id: track.id,
                  label: track.name || track.lang || `Ses ${index + 1}`
                }))}
                value={currentAudioTrack ?? undefined}
                onSelect={(id) => setCurrentAudioTrack(id)}
                placeholder="Aktif dublaj sec"
              />
            ) : (
              <p className="rounded-lg border border-surface-700 bg-surface-900 px-3 py-2 text-sm text-surface-500">
                Aktif yayin icin ses kanali bulunamadi.
              </p>
            )}
          </div>

          <div>
            <label className="text-sm text-surface-400 mb-2 block">Aktif Yayin Altyazisi</label>
            {subtitleTracks.length > 0 ? (
              <Dropdown
                items={[
                  { id: '__off__', label: 'Kapali' },
                  ...subtitleTracks.map((track, index) => ({
                    id: String(track.id),
                    label: track.name || track.lang || `Altyazi ${index + 1}`
                  }))
                ]}
                value={currentSubtitleTrack ?? '__off__'}
                onSelect={(id) => {
                  if (id === '__off__') {
                    setCurrentSubtitleTrack(null)
                    setSubtitleCues([])
                    setActiveSubtitleCues([])
                    return
                  }
                  setCurrentSubtitleTrack(id)
                }}
                placeholder="Aktif altyazi sec"
              />
            ) : (
              <p className="rounded-lg border border-surface-700 bg-surface-900 px-3 py-2 text-sm text-surface-500">
                Aktif yayin icin altyazi bulunamadi.
              </p>
            )}
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
            <span className="text-sm text-surface-300">Kanal seciminde otomatik oynat</span>
          </label>
        </div>

        <div className="mt-5">
          <Input
            id="tmdb-api-key"
            label="TMDB API Anahtari (opsiyonel)"
            type="password"
            value={settings.tmdbApiKey}
            onChange={(e) => updateSettings({ tmdbApiKey: e.target.value })}
            placeholder="TMDB v3 anahtari veya v4 bearer token girin"
          />
          <p className="mt-1 text-xs text-surface-500">
            Film/dizi detaylari ile bolum adlarini zenginlestirmek icin kullanilir.
          </p>
        </div>
      </section>

      {/* EPG Settings */}
      <section>
        <h2 className="text-lg font-semibold mb-4">EPG</h2>
        <Input
          id="epg-refresh"
          label="EPG Yenileme Araligi (dakika)"
          type="number"
          min={5}
          max={1440}
          step={1}
          value={settings.epgRefreshInterval}
          onChange={(e) => {
            const next = Number.parseInt(e.target.value, 10)
            updateSettings({ epgRefreshInterval: Number.isFinite(next) ? next : 60 })
          }}
        />
      </section>

      <div className="border-t border-surface-800 pt-6">
        <Button variant="danger" onClick={resetSettings}>
          Tum Ayarlari Sifirla
        </Button>
      </div>
    </div>
  )
}
