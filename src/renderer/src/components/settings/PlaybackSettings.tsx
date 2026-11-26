import { useMemo } from 'react'
import { useStore } from '@/store'
import { Dropdown } from '@/components/ui/Dropdown'
import { SEEK_STEP_OPTIONS, type UserSettings } from '@/types/settings'
import { strings } from '@/strings'
import { formatLanguageLabel, useLanguageCodes } from './language-options'
import { SettingRow, SettingsCard, SettingsGroup, Switch } from './controls'

const text = strings.settings.playback

/** The width a dropdown takes at the right of its row. */
const DROPDOWN_CLASS = 'w-[280px] max-w-full'

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
    <div className="flex flex-col gap-8">
      <SettingsGroup title={text.audioGroup}>
        <SettingsCard>
          <SettingRow
            label={text.audioLanguage}
            labelId="preferred-audio-language-label"
            help={text.audioLanguageHint}
            control={
              <Dropdown
                id="preferred-audio-language"
                labelledBy="preferred-audio-language-label"
                items={audioLanguageItems}
                value={settings.preferredAudioLanguage}
                onSelect={(id) => updateSettings({ preferredAudioLanguage: id })}
                placeholder={text.audioLanguagePlaceholder}
                className={DROPDOWN_CLASS}
              />
            }
          />
          <SettingRow
            label={text.passthrough}
            htmlFor="audio-passthrough"
            help={text.passthroughHint}
            helpId="audio-passthrough-help"
            control={
              <Switch
                id="audio-passthrough"
                checked={settings.audioPassthrough}
                onChange={(checked) => updateSettings({ audioPassthrough: checked })}
                describedBy="audio-passthrough-help"
              />
            }
          >
            {settings.audioPassthrough && (
              <p className="flex items-start gap-2.5 text-sm text-surface-300">
                <span
                  aria-hidden="true"
                  className={`mt-[5px] size-2 shrink-0 rounded-full ${passthroughActive ? 'bg-mint' : 'bg-surface-600'}`}
                />
                <span>{passthroughActive ? text.passthroughActive : text.passthroughInactive}</span>
              </p>
            )}
          </SettingRow>
        </SettingsCard>
      </SettingsGroup>

      <SettingsGroup title={text.controlsGroup}>
        <SettingsCard>
          <SettingRow
            label={text.seekStep}
            labelId="seek-step-label"
            help={text.seekStepHint}
            control={
              <Dropdown
                id="seek-step"
                labelledBy="seek-step-label"
                items={SEEK_STEP_ITEMS}
                value={String(settings.seekStepSeconds)}
                onSelect={(id) => updateSettings({ seekStepSeconds: Number(id) })}
                placeholder={text.seekStep}
                className={DROPDOWN_CLASS}
              />
            }
          />
        </SettingsCard>
      </SettingsGroup>

      <SettingsGroup title={text.videoGroup}>
        <SettingsCard>
          <SettingRow
            label={text.liveFormat}
            labelId="live-stream-format-label"
            help={text.liveFormatHint}
            control={
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
                className={DROPDOWN_CLASS}
              />
            }
          />
          <SettingRow
            label={text.hardwareDecoding}
            htmlFor="hardware-acceleration"
            help={text.hardwareDecodingHint}
            helpId="hardware-acceleration-help"
            control={
              <Switch
                id="hardware-acceleration"
                checked={settings.hardwareAcceleration}
                onChange={(checked) => updateSettings({ hardwareAcceleration: checked })}
                describedBy="hardware-acceleration-help"
              />
            }
          />
          <SettingRow
            label={text.cornerPlayer}
            htmlFor="keep-playing-in-corner"
            help={text.cornerPlayerHint}
            helpId="keep-playing-in-corner-help"
            control={
              <Switch
                id="keep-playing-in-corner"
                checked={settings.keepPlayingInCorner}
                onChange={(checked) => updateSettings({ keepPlayingInCorner: checked })}
                describedBy="keep-playing-in-corner-help"
              />
            }
          />
        </SettingsCard>
      </SettingsGroup>
    </div>
  )
}

const SEEK_STEP_ITEMS = SEEK_STEP_OPTIONS.map((seconds) => ({ id: String(seconds), label: text.seekStepOption(seconds) }))

const LIVE_STREAM_FORMAT_ITEMS: Array<{ id: UserSettings['liveStreamFormat']; label: string }> = [
  { id: 'auto', label: text.liveFormatAuto },
  { id: 'm3u8', label: text.liveFormatHls },
  { id: 'ts', label: text.liveFormatTs }
]
