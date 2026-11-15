import { useEffect, useState } from 'react'
import { useStore } from '@/store'
import {
  clampEpgRefreshInterval,
  MAX_EPG_REFRESH_MINUTES,
  MIN_EPG_REFRESH_MINUTES
} from '@/store/settings-slice'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Dropdown } from '@/components/ui/Dropdown'
import { Input } from '@/components/ui/Input'

/**
 * Edits a local draft and commits on blur or Enter. Clamping on every
 * keystroke turned typing "120" into 5, 52, 520 because each partial value was
 * pushed to the minimum before the next digit arrived.
 */
export function EpgRefreshIntervalInput() {
  const epgRefreshInterval = useStore((s) => s.settings.epgRefreshInterval)
  const updateSettings = useStore((s) => s.updateSettings)
  const [draft, setDraft] = useState(String(epgRefreshInterval))

  // Follow outside changes (reset, another window) while not being edited.
  useEffect(() => {
    setDraft(String(epgRefreshInterval))
  }, [epgRefreshInterval])

  const commit = () => {
    const parsed = Number.parseInt(draft, 10)
    if (!Number.isFinite(parsed)) {
      setDraft(String(epgRefreshInterval))
      return
    }
    const next = clampEpgRefreshInterval(parsed)
    setDraft(String(next))
    if (next !== epgRefreshInterval) updateSettings({ epgRefreshInterval: next })
  }

  return (
    <Input
      id="epg-refresh"
      label="EPG Yenileme Aralığı (dakika)"
      type="number"
      min={MIN_EPG_REFRESH_MINUTES}
      max={MAX_EPG_REFRESH_MINUTES}
      step={1}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
        }
      }}
    />
  )
}

export function GeneralSettings() {
  const epgTimeFormat = useStore((s) => s.settings.epgTimeFormat)
  const tmdbApiKey = useStore((s) => s.settings.tmdbApiKey)
  const updateSettings = useStore((s) => s.updateSettings)
  const resetSettings = useStore((s) => s.resetSettings)
  const watchProgressCount = useStore((s) => s.watchProgress.length)
  const clearWatchProgress = useStore((s) => s.clearWatchProgress)
  const [confirmingReset, setConfirmingReset] = useState(false)

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
          value={epgTimeFormat}
          onSelect={(id) => updateSettings({ epgTimeFormat: id as '12h' | '24h' })}
          placeholder="Saat formatı"
        />
      </div>

      <div className="rounded-lg border border-surface-800 bg-surface-900 p-5">
        <EpgRefreshIntervalInput />
        <p className="mt-1 text-xs text-surface-500">
          {MIN_EPG_REFRESH_MINUTES} ile {MAX_EPG_REFRESH_MINUTES} dakika arasında bir değer girin.
        </p>
      </div>

      <div className="rounded-lg border border-surface-800 bg-surface-900 p-5">
        <Input
          id="tmdb-api-key"
          label="TMDB API Anahtarı (opsiyonel)"
          type="password"
          value={tmdbApiKey}
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
            ? `${watchProgressCount} içerik için kaldığınız yer kayıtlı.`
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
          Ayarlar varsayılana döner. Kaynaklarınız, favorileriniz, gizlediğiniz kategoriler ve
          TMDB anahtarınız etkilenmez.
        </p>
        <Button variant="danger" className="mt-3" onClick={() => setConfirmingReset(true)}>
          Tüm Ayarları Sıfırla
        </Button>
      </div>

      <ConfirmDialog
        isOpen={confirmingReset}
        title="Ayarlar sıfırlansın mı?"
        confirmLabel="Sıfırla"
        destructive
        onCancel={() => setConfirmingReset(false)}
        onConfirm={() => {
          resetSettings()
          setConfirmingReset(false)
        }}
      >
        <p>
          Oynatma, altyazı, EPG ve saat ayarları varsayılan değerlerine döner. Bu işlem geri
          alınamaz.
        </p>
        <p className="mt-2 text-surface-400">
          TMDB anahtarınız, kaynaklarınız, favorileriniz ve gizlediğiniz kategoriler korunur.
        </p>
      </ConfirmDialog>
    </div>
  )
}
