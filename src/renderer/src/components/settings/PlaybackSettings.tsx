import { useMemo } from 'react'
import { useStore } from '@/store'
import { Dropdown } from '@/components/ui/Dropdown'
import { formatLanguageLabel, useLanguageCodes } from './language-options'

export function PlaybackSettings() {
  // Select individually so playback state churn doesn't re-render the whole
  // form while a stream is running in the mini player.
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)
  const setVolume = useStore((s) => s.setVolume)
  // Reported by the mpv poll: passthrough is armed AND the device accepted it.
  const passthroughActive = useStore((s) => s.passthroughActive)

  const languageCodes = useLanguageCodes()
  const audioLanguageItems = useMemo(
    () => [
      { id: 'auto', label: 'Otomatik (yayın varsayılanı)' },
      ...languageCodes.map((code) => ({ id: code, label: formatLanguageLabel(code) }))
    ],
    [languageCodes]
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg border border-surface-800 bg-surface-900 p-5">
        <label htmlFor="default-volume" className="mb-1 block text-sm text-surface-400">
          Varsayılan Ses Seviyesi
        </label>
        <input
          id="default-volume"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={settings.defaultVolume}
          onChange={(e) => {
            const v = parseFloat(e.target.value)
            updateSettings({ defaultVolume: v })
            setVolume(v)
          }}
          className="w-full"
        />
        <span className="text-xs text-surface-500">{Math.round(settings.defaultVolume * 100)}%</span>
      </div>

      <div className="rounded-lg border border-surface-800 bg-surface-900 p-5">
        <p id="preferred-audio-language-label" className="mb-2 text-sm text-surface-400">
          Tercih Edilen Dublaj Dili
        </p>
        <Dropdown
          id="preferred-audio-language"
          labelledBy="preferred-audio-language-label"
          items={audioLanguageItems}
          value={settings.preferredAudioLanguage}
          onSelect={(id) => updateSettings({ preferredAudioLanguage: id })}
          placeholder="Tercih edilen dublaj dili"
        />
        <p className="mt-1 text-xs text-surface-500">
          Yayında bu dilde bir ses kanalı varsa kendiliğinden seçilir.
        </p>
      </div>

      <div className="flex flex-col gap-4 rounded-lg border border-surface-800 bg-surface-900 p-5">
        <div>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={settings.autoPlay}
              onChange={(e) => updateSettings({ autoPlay: e.target.checked })}
              className="rounded border-surface-700 bg-surface-900 text-accent focus:ring-accent"
            />
            <span className="text-sm text-surface-300">Kanal seçiminde otomatik oynat</span>
          </label>
        </div>

        <div>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={settings.hardwareAcceleration}
              onChange={(e) => updateSettings({ hardwareAcceleration: e.target.checked })}
              className="rounded border-surface-700 bg-surface-900 text-accent focus:ring-accent"
            />
            <span className="text-sm text-surface-300">Donanım hızlandırmalı video çözme</span>
          </label>
          <p className="mt-1 text-xs text-surface-500">
            Video çözmeyi ekran kartına devreder; işlemci kullanımını belirgin şekilde düşürür.
            Görüntü siyah geliyor veya takılıyorsa kapatın.
          </p>
        </div>

        <div>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={settings.audioPassthrough}
              onChange={(e) => updateSettings({ audioPassthrough: e.target.checked })}
              className="rounded border-surface-700 bg-surface-900 text-accent focus:ring-accent"
            />
            <span className="text-sm text-surface-300">
              Ses passthrough (AC3 / DTS / E-AC3 / TrueHD)
            </span>
          </label>
          <p className="mt-1 text-xs text-surface-500">
            Sesi çözmeden doğrudan ses sisteminize gönderir. Yalnızca bu formatları kendisi
            çözebilen bir amfi veya ses sistemi bağlıysa işe yarar.
          </p>
          {settings.audioPassthrough && (
            <p className="mt-1 text-xs text-surface-400">
              {passthroughActive
                ? 'Şu anki yayında etkin.'
                : 'Şu anki yayında kullanılmıyor; ses normal şekilde çalınıyor. Cihazınız bu formatı desteklemiyorsa veya yayın bu formatlarda değilse beklenen durumdur.'}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
