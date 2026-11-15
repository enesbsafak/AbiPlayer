import { useEffect, useId, useState } from 'react'
import { useStore } from '@/store'
import {
  clampEpgRefreshInterval,
  MAX_EPG_REFRESH_MINUTES,
  MIN_EPG_REFRESH_MINUTES
} from '@/store/settings-slice'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { toUserMessage } from '@/services/user-error'
import { strings } from '@/strings'
import { saveTmdbApiKey } from './tmdb-api-key'
import { ACTION, FieldError, INPUT_CLASS, PillChoice, SettingRow, SettingsCard, SettingsGroup } from './controls'

const text = strings.settings.general

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
    <SettingRow
      label={text.epgInterval}
      htmlFor="epg-refresh"
      help={text.epgIntervalHint(MIN_EPG_REFRESH_MINUTES, MAX_EPG_REFRESH_MINUTES)}
      helpId="epg-refresh-help"
      control={
        <input
          id="epg-refresh"
          type="number"
          min={MIN_EPG_REFRESH_MINUTES}
          max={MAX_EPG_REFRESH_MINUTES}
          step={1}
          value={draft}
          aria-describedby="epg-refresh-help"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            }
          }}
          className={`${INPUT_CLASS} !w-[120px] text-center font-bold tabular-nums`}
        />
      }
    />
  )
}

/**
 * The TMDB key, edited as a draft and saved on blur or Enter to the secure
 * credential store (not localStorage).
 */
export function TmdbApiKeyInput() {
  const tmdbApiKey = useStore((s) => s.settings.tmdbApiKey)
  const [draft, setDraft] = useState(tmdbApiKey)
  const [status, setStatus] = useState<{ kind: 'saving' | 'saved' | 'error'; message: string } | null>(null)

  // Follow outside changes (read from the secure store at start) while not being edited.
  useEffect(() => {
    setDraft(tmdbApiKey)
  }, [tmdbApiKey])

  const commit = async () => {
    if (draft.trim() === tmdbApiKey) return
    setStatus({ kind: 'saving', message: strings.common.saving })
    try {
      await saveTmdbApiKey(draft)
      setStatus({ kind: 'saved', message: text.tmdbKeySaved })
    } catch (error) {
      setStatus({ kind: 'error', message: text.tmdbKeySaveFailed(toUserMessage(error)) })
    }
  }

  return (
    <SettingRow label={text.tmdbKey} htmlFor="tmdb-api-key" help={text.tmdbKeyHint} helpId="tmdb-api-key-help">
      <input
        id="tmdb-api-key"
        type="password"
        value={draft}
        aria-describedby="tmdb-api-key-help"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void commit()
          }
        }}
        placeholder={text.tmdbKeyPlaceholder}
        autoComplete="off"
        className={INPUT_CLASS}
      />
      {status &&
        (status.kind === 'error' ? (
          <FieldError>{status.message}</FieldError>
        ) : (
          <p role="status" className="flex items-center gap-2 px-1 text-sm text-surface-300">
            {status.kind === 'saved' && <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-mint" />}
            {status.message}
          </p>
        ))}
    </SettingRow>
  )
}

export function GeneralSettings() {
  const epgTimeFormat = useStore((s) => s.settings.epgTimeFormat)
  const updateSettings = useStore((s) => s.updateSettings)
  const resetSettings = useStore((s) => s.resetSettings)
  const watchProgressCount = useStore((s) => s.watchProgress.length)
  const clearWatchProgress = useStore((s) => s.clearWatchProgress)
  const [confirming, setConfirming] = useState<'reset' | 'history' | null>(null)
  const timeFormatLabelId = useId()

  return (
    <div className="flex flex-col gap-8">
      <SettingsGroup title={text.timeGroup}>
        <SettingsCard>
          <SettingRow
            label={text.timeFormat}
            labelId={timeFormatLabelId}
            help={text.timeFormatHint}
            control={
              <PillChoice<'24h' | '12h'>
                labelledBy={timeFormatLabelId}
                options={[
                  { id: '24h', label: text.timeFormat24 },
                  { id: '12h', label: text.timeFormat12 }
                ]}
                value={epgTimeFormat}
                onChange={(id) => updateSettings({ epgTimeFormat: id })}
              />
            }
          />
          <EpgRefreshIntervalInput />
        </SettingsCard>
      </SettingsGroup>

      <SettingsGroup title={text.tmdbGroup}>
        <SettingsCard>
          <TmdbApiKeyInput />
        </SettingsCard>
      </SettingsGroup>

      {/* Apart from the rest, in coral; each asks first. */}
      <SettingsGroup title={text.dangerGroup} tone="coral">
        <SettingsCard>
          <SettingRow
            label={text.history}
            help={text.historyCount(watchProgressCount)}
            control={
              <button
                type="button"
                className={ACTION.danger}
                onClick={() => setConfirming('history')}
                disabled={watchProgressCount === 0}
              >
                {text.clearHistory}
              </button>
            }
          />
          <SettingRow
            label={text.resetAll}
            help={text.resetAllHint}
            control={
              <button type="button" className={ACTION.danger} onClick={() => setConfirming('reset')}>
                {text.resetAll}
              </button>
            }
          />
        </SettingsCard>
      </SettingsGroup>

      <ConfirmDialog
        isOpen={confirming === 'history'}
        title={text.clearHistoryConfirmTitle}
        confirmLabel={text.clearHistoryConfirm}
        destructive
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          clearWatchProgress()
          setConfirming(null)
        }}
      >
        <p>{text.clearHistoryConfirmBody(watchProgressCount)}</p>
      </ConfirmDialog>

      <ConfirmDialog
        isOpen={confirming === 'reset'}
        title={text.resetConfirmTitle}
        confirmLabel={strings.common.reset}
        destructive
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          resetSettings()
          setConfirming(null)
        }}
      >
        <p>{text.resetConfirmBody}</p>
        <p className="mt-2 text-surface-400">{text.resetConfirmKept}</p>
      </ConfirmDialog>
    </div>
  )
}
