import { useMemo } from 'react'
import { useStore } from '@/store'
import { Dropdown } from '@/components/ui/Dropdown'
import { strings } from '@/strings'
import { formatLanguageLabel, useLanguageCodes } from './language-options'

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
    <div className="flex flex-col gap-6">
      <div className="rounded-lg border border-surface-800 bg-surface-900 p-5">
        <p id="preferred-subtitle-language-label" className="mb-2 text-sm text-surface-400">
          {text.language}
        </p>
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
        />
        <p className="mt-1 text-xs text-surface-500">
          {text.languageHint}
        </p>
      </div>

      <div className="rounded-lg border border-surface-800 bg-surface-900 p-5">
        <p className="mb-4 text-sm font-medium text-surface-200">{text.appearance}</p>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="subtitle-font-size" className="mb-1 block text-sm text-surface-400">
              {text.fontSize}
            </label>
            <input
              id="subtitle-font-size"
              type="range"
              min={16}
              max={48}
              step={2}
              value={settings.subtitleFontSize}
              onChange={(e) => updateSettings({ subtitleFontSize: parseInt(e.target.value) })}
              className="w-full"
            />
            <span className="text-xs text-surface-500">{settings.subtitleFontSize}px</span>
          </div>

          <div>
            <label htmlFor="subtitle-color" className="mb-1 block text-sm text-surface-400">
              {text.color}
            </label>
            <input
              id="subtitle-color"
              type="color"
              value={settings.subtitleColor}
              onChange={(e) => updateSettings({ subtitleColor: e.target.value })}
              className="h-10 w-full cursor-pointer rounded-lg border border-surface-700 bg-surface-900 px-2"
            />
          </div>
        </div>

        <div className="mt-4">
          <label
            htmlFor="subtitle-background-opacity"
            className="mb-1 block text-sm text-surface-400"
          >
            {text.backgroundOpacity}
          </label>
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
            className="w-full"
          />
          <span className="text-xs text-surface-500">{subtitleOpacity}%</span>
        </div>

        <div className="mt-4">
          <p className="text-xs font-medium text-surface-500">{text.preview}</p>
          <div className="mt-2 rounded-lg border border-surface-800 bg-black/70 p-6 text-center">
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
        </div>
      </div>
    </div>
  )
}
