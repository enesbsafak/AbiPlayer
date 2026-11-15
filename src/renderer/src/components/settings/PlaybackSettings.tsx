import { useMemo } from 'react'
import { useStore } from '@/store'
import { Dropdown } from '@/components/ui/Dropdown'
import type { UserSettings } from '@/types/settings'
import { strings } from '@/strings'
import { formatLanguageLabel, useLanguageCodes } from './language-options'

const text = strings.settings.playback

export function PlaybackSettings() {
  // Select individually so playback state churn doesn't re-render the whole
  // form while a stream is running in the mini player.
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)
  // Reported by the mpv poll: passthrough is armed AND the device accepted it.
  const passthroughActive = useStore((s) => s.passthroughActive)

  const languageCodes = useLanguageCodes(settings.preferredAudioLanguage)
  const audioLanguageItems = useMemo(
    () => [
      { id: 'auto', label: text.audioLanguageAuto },
      ...languageCodes.map((code) => ({ id: code, label: formatLanguageLabel(code) }))
    ],
    [languageCodes]
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg border border-surface-800 bg-surface-900 p-5">
        <p id="preferred-audio-language-label" className="mb-2 text-sm text-surface-400">
          {text.audioLanguage}
        </p>
        <Dropdown
          id="preferred-audio-language"
          labelledBy="preferred-audio-language-label"
          items={audioLanguageItems}
          value={settings.preferredAudioLanguage}
          onSelect={(id) => updateSettings({ preferredAudioLanguage: id })}
          placeholder={text.audioLanguagePlaceholder}
        />
        <p className="mt-1 text-xs text-surface-500">
          {text.audioLanguageHint}
        </p>
      </div>

      <div className="rounded-lg border border-surface-800 bg-surface-900 p-5">
        <p id="live-stream-format-label" className="mb-2 text-sm text-surface-400">
          {text.liveFormat}
        </p>
        <Dropdown
          id="live-stream-format"
          labelledBy="live-stream-format-label"
          items={LIVE_STREAM_FORMAT_ITEMS}
          value={settings.liveStreamFormat}
          onSelect={(id) => {
            const format = LIVE_STREAM_FORMAT_ITEMS.find((item) => item.id === id)?.id
            if (format) updateSettings({ liveStreamFormat: format })
          }}
          placeholder={text.liveFormat}
        />
        <p className="mt-1 text-xs text-surface-500">
          {text.liveFormatHint}
        </p>
      </div>

      <div className="flex flex-col gap-4 rounded-lg border border-surface-800 bg-surface-900 p-5">
        <div>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={settings.hardwareAcceleration}
              onChange={(e) => updateSettings({ hardwareAcceleration: e.target.checked })}
              className="rounded border-surface-700 bg-surface-900 text-accent focus:ring-accent"
            />
            <span className="text-sm text-surface-300">{text.hardwareDecoding}</span>
          </label>
          <p className="mt-1 text-xs text-surface-500">
            {text.hardwareDecodingHint}
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
              {text.passthrough}
            </span>
          </label>
          <p className="mt-1 text-xs text-surface-500">
            {text.passthroughHint}
          </p>
          {settings.audioPassthrough && (
            <p className="mt-1 text-xs text-surface-400">
              {passthroughActive ? text.passthroughActive : text.passthroughInactive}
            </p>
          )}
        </div>

        <div>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={settings.keepPlayingInCorner}
              onChange={(e) => updateSettings({ keepPlayingInCorner: e.target.checked })}
              className="rounded border-surface-700 bg-surface-900 text-accent focus:ring-accent"
            />
            <span className="text-sm text-surface-300">
              {text.cornerPlayer}
            </span>
          </label>
          <p className="mt-1 text-xs text-surface-500">
            {text.cornerPlayerHint}
          </p>
        </div>
      </div>
    </div>
  )
}

const LIVE_STREAM_FORMAT_ITEMS: Array<{ id: UserSettings['liveStreamFormat']; label: string }> = [
  { id: 'auto', label: text.liveFormatAuto },
  { id: 'm3u8', label: text.liveFormatHls },
  { id: 'ts', label: text.liveFormatTs }
]
