import { useStore } from '@/store'
import { Button } from '@/components/ui/Button'
import { Dropdown } from '@/components/ui/Dropdown'
import { Input } from '@/components/ui/Input'

export function GeneralSettings() {
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)
  const resetSettings = useStore((s) => s.resetSettings)
  const watchProgressCount = useStore((s) => s.watchProgress.length)
  const clearWatchProgress = useStore((s) => s.clearWatchProgress)

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg border border-surface-800 bg-surface-900 p-5">
        <p id="epg-time-format-label" className="mb-2 text-sm text-surface-400">
          Saat Formatı
        </p>
        <Dropdown
          id="epg-time-format"
          labelledBy="epg-time-format-label"
          items={[
            { id: '24h', label: '24 Saat' },
            { id: '12h', label: '12 Saat' }
          ]}
          value={settings.epgTimeFormat}
          onSelect={(id) => updateSettings({ epgTimeFormat: id as '12h' | '24h' })}
          placeholder="Saat formatı"
        />
      </div>

      <div className="rounded-lg border border-surface-800 bg-surface-900 p-5">
        <Input
          id="epg-refresh"
          label="EPG Yenileme Aralığı (dakika)"
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
      </div>

      <div className="rounded-lg border border-surface-800 bg-surface-900 p-5">
        <Input
          id="tmdb-api-key"
          label="TMDB API Anahtarı (opsiyonel)"
          type="password"
          value={settings.tmdbApiKey}
          onChange={(e) => updateSettings({ tmdbApiKey: e.target.value })}
          placeholder="TMDB v3 anahtarı veya v4 bearer token girin"
        />
        <p className="mt-1 text-xs text-surface-500">
          Film ve dizi detayları ile bölüm adlarını zenginleştirmek için kullanılır.
        </p>
      </div>

      <div className="rounded-lg border border-surface-800 bg-surface-900 p-5">
        <p className="text-sm font-medium text-surface-200">İzleme Geçmişi</p>
        <p className="mt-1 text-xs text-surface-500">
          {watchProgressCount > 0
            ? `Ana sayfadaki "Devam Et" listesinde ${watchProgressCount} içerik var.`
            : 'Kaldığınız yer kaydedilen bir içerik yok.'}
        </p>
        <Button
          variant="secondary"
          className="mt-3"
          onClick={clearWatchProgress}
          disabled={watchProgressCount === 0}
        >
          İzleme Geçmişini Temizle
        </Button>
      </div>

      <div className="rounded-lg border border-red-500/25 bg-surface-900 p-5">
        <p className="text-sm font-medium text-surface-200">Tüm Ayarları Sıfırla</p>
        <p className="mt-1 text-xs text-surface-500">
          Ayarlar varsayılana döner. Kaynaklarınız, favorileriniz ve gizlediğiniz kategoriler
          etkilenmez.
        </p>
        <Button variant="danger" className="mt-3" onClick={resetSettings}>
          Tüm Ayarları Sıfırla
        </Button>
      </div>
    </div>
  )
}
