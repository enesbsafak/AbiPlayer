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
import { toUserMessage } from '@/services/user-error'
import { strings } from '@/strings'
import { saveTmdbApiKey } from './tmdb-api-key'

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
    <Input
      id="epg-refresh"
      label={text.epgInterval}
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
    <>
      <Input
        id="tmdb-api-key"
        label={text.tmdbKey}
        type="password"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void commit()
          }
        }}
        placeholder={text.tmdbKeyPlaceholder}
      />
      <p className="mt-1 text-xs text-surface-500">
        {text.tmdbKeyHint}
      </p>
      {status && (
        <p className={`mt-1 text-xs ${status.kind === 'error' ? 'text-red-400' : 'text-surface-400'}`} role={status.kind === 'error' ? 'alert' : 'status'}>
          {status.message}
        </p>
      )}
    </>
  )
}

export function GeneralSettings() {
  const epgTimeFormat = useStore((s) => s.settings.epgTimeFormat)
  const updateSettings = useStore((s) => s.updateSettings)
  const resetSettings = useStore((s) => s.resetSettings)
  const watchProgressCount = useStore((s) => s.watchProgress.length)
  const clearWatchProgress = useStore((s) => s.clearWatchProgress)
  const [confirmingReset, setConfirmingReset] = useState(false)

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg border border-surface-800 bg-surface-900 p-5">
        <p id="epg-time-format-label" className="mb-2 text-sm text-surface-400">
          {text.timeFormat}
        </p>
        <Dropdown
          id="epg-time-format"
          labelledBy="epg-time-format-label"
          items={[
            { id: '24h', label: text.timeFormat24 },
            { id: '12h', label: text.timeFormat12 }
          ]}
          value={epgTimeFormat}
          onSelect={(id) => updateSettings({ epgTimeFormat: id as '12h' | '24h' })}
          placeholder={text.timeFormatPlaceholder}
        />
      </div>

      <div className="rounded-lg border border-surface-800 bg-surface-900 p-5">
        <EpgRefreshIntervalInput />
        <p className="mt-1 text-xs text-surface-500">
          {text.epgIntervalHint(MIN_EPG_REFRESH_MINUTES, MAX_EPG_REFRESH_MINUTES)}
        </p>
      </div>

      <div className="rounded-lg border border-surface-800 bg-surface-900 p-5">
        <TmdbApiKeyInput />
      </div>

      <div className="rounded-lg border border-surface-800 bg-surface-900 p-5">
        <p className="text-sm font-medium text-surface-200">{text.history}</p>
        <p className="mt-1 text-xs text-surface-500">
          {text.historyCount(watchProgressCount)}
        </p>
        <Button
          variant="secondary"
          className="mt-3"
          onClick={clearWatchProgress}
          disabled={watchProgressCount === 0}
        >
          {text.clearHistory}
        </Button>
      </div>

      <div className="rounded-lg border border-red-500/25 bg-surface-900 p-5">
        <p className="text-sm font-medium text-surface-200">{text.resetAll}</p>
        <p className="mt-1 text-xs text-surface-500">
          {text.resetAllHint}
        </p>
        <Button variant="danger" className="mt-3" onClick={() => setConfirmingReset(true)}>
          {text.resetAll}
        </Button>
      </div>

      <ConfirmDialog
        isOpen={confirmingReset}
        title={text.resetConfirmTitle}
        confirmLabel={strings.common.reset}
        destructive
        onCancel={() => setConfirmingReset(false)}
        onConfirm={() => {
          resetSettings()
          setConfirmingReset(false)
        }}
      >
        <p>
          {text.resetConfirmBody}
        </p>
        <p className="mt-2 text-surface-400">
          {text.resetConfirmKept}
        </p>
      </ConfirmDialog>
    </div>
  )
}
