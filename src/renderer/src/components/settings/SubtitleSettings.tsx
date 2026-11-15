import { useMemo } from 'react'
import { useStore } from '@/store'
import { Dropdown } from '@/components/ui/Dropdown'
import { palette } from '@/theme/palette'
import { strings } from '@/strings'
import { formatLanguageLabel, useLanguageCodes } from './language-options'
import { SettingRow, SettingsCard, SettingsGroup } from './controls'

const text = strings.settings.subtitles

function parseSubtitleBackgroundOpacity(background: string): number {
  const match = background.match(
    /rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*([0-9]*\.?[0-9]+)\s*)?\)/i
  )
  if (!match) return 75
  const alpha = match[1] ? Number.parseFloat(match[1]) : 1
  if (!Number.isFinite(alpha)) return 75
  return Math.round(Math.max(0, Math.min(1, alpha)) * 100)
}

/**
 * A thick, fully rounded slider: the part up to the knob is sky, the rest the
 * ground (two flat colours meeting at the knob, not a blend).
 */
const RANGE_CLASS =
  'h-3 w-[240px] max-w-full cursor-pointer appearance-none rounded-full ' +
  '[&::-webkit-slider-thumb]:size-7 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white'

function rangeFill(value: number, min: number, max: number): string {
  const percent = ((value - min) / (max - min)) * 100
  return `linear-gradient(to right, ${palette.sky} ${percent}%, ${palette.ground} ${percent}%)`
}

export function SubtitleSettings() {
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)

  const subtitleOpacity = parseSubtitleBackgroundOpacity(settings.subtitleBackground)
  const languageCodes = useLanguageCodes(settings.preferredSubtitleLanguage)

  const subtitleLanguageItems = useMemo(
    () => [
      { id: 'off', label: text.languageOff },
      { id: 'auto', label: text.languageAuto },
      ...languageCodes.map((code) => ({ id: code, label: formatLanguageLabel(code) }))
    ],
    [languageCodes]
  )

  // One control drives two settings: "off" means don't auto-enable subtitles at
  // all, anything else means enable and prefer that language.
  const subtitlePreferenceValue = settings.defaultSubtitleEnabled
    ? settings.preferredSubtitleLanguage
    : 'off'

  return (
    <div className="flex flex-col gap-8">
      <SettingsGroup title={text.languageGroup}>
        <SettingsCard>
          <SettingRow
            label={text.language}
            labelId="preferred-subtitle-language-label"
            help={text.languageHint}
            control={
              <Dropdown
                id="preferred-subtitle-language"
                labelledBy="preferred-subtitle-language-label"
                items={subtitleLanguageItems}
                value={subtitlePreferenceValue}
                onSelect={(id) => {
                  if (id === 'off') {
                    updateSettings({ defaultSubtitleEnabled: false, preferredSubtitleLanguage: 'auto' })
                  } else {
                    updateSettings({ defaultSubtitleEnabled: true, preferredSubtitleLanguage: id })
                  }
                }}
                placeholder={text.languagePlaceholder}
                className="w-[280px] max-w-full"
              />
            }
          />
        </SettingsCard>
      </SettingsGroup>

      <SettingsGroup title={text.appearance}>
        <SettingsCard>
          <SettingRow
            label={text.fontSize}
            htmlFor="subtitle-font-size"
            help={text.fontSizeHint}
            control={
              <div className="flex items-center gap-4">
                <input
                  id="subtitle-font-size"
                  type="range"
                  min={16}
                  max={48}
                  step={2}
                  value={settings.subtitleFontSize}
                  onChange={(e) => updateSettings({ subtitleFontSize: parseInt(e.target.value) })}
                  className={RANGE_CLASS}
                  style={{ background: rangeFill(settings.subtitleFontSize, 16, 48) }}
                />
                <span className="w-14 text-right text-[15px] font-bold tabular-nums">
                  {text.fontSizeValue(settings.subtitleFontSize)}
                </span>
              </div>
            }
          />
          <SettingRow
            label={text.color}
            htmlFor="subtitle-color"
            help={text.colorHint}
            control={
              <input
                id="subtitle-color"
                type="color"
                value={settings.subtitleColor}
                onChange={(e) => updateSettings({ subtitleColor: e.target.value })}
                className="h-11 w-[88px] cursor-pointer rounded-full bg-ground p-1.5 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-0"
              />
            }
          />
          <SettingRow
            label={text.backgroundOpacity}
            htmlFor="subtitle-background-opacity"
            help={text.backgroundOpacityHint}
            control={
              <div className="flex items-center gap-4">
                <input
                  id="subtitle-background-opacity"
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
                  className={RANGE_CLASS}
                  style={{ background: rangeFill(subtitleOpacity, 0, 100) }}
                />
                <span className="w-14 text-right text-[15px] font-bold tabular-nums">{text.opacityValue(subtitleOpacity)}</span>
              </div>
            }
          />
          <SettingRow label={text.preview}>
            <div className="flex min-h-[120px] items-center justify-center rounded-2xl bg-deep p-6 text-center">
              <span
                className="inline-block rounded px-3 py-1 leading-relaxed"
                style={{
                  fontSize: `${settings.subtitleFontSize}px`,
                  color: settings.subtitleColor,
                  backgroundColor: settings.subtitleBackground
                }}
              >
                {text.previewText}
              </span>
            </div>
          </SettingRow>
        </SettingsCard>
      </SettingsGroup>
    </div>
  )
}
