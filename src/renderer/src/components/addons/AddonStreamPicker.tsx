import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import type { AddonStreamCandidate } from '@/addons/streams'
import { strings } from '@/strings'
import {
  nextCandidateIndex,
  pickerPhase,
  type PickerAddon,
  type StreamPickerPhase,
  type StreamPickerState
} from './stream-picker-model'

const text = strings.player.addonStreams

const CANDIDATE_ATTRIBUTE = 'data-stream-candidate'

export interface AddonStreamPickerProps {
  /** The film or episode, as the player will title it. */
  itemName: string
  /** Null while the add-ons have not been asked yet (the app is still reading their addresses). */
  picker: StreamPickerState | null
  /** The remembered choice may still be played by itself. */
  autoWaiting: boolean
  /** mpv is missing: the built-in `<video>` would play the file. */
  mpvMissing: boolean
  onChoose: (candidate: AddonStreamCandidate) => void
  onClose: () => void
  onRetry: () => void
  onOpenSettings: () => void
  /** The viewer pressed a key or the pointer inside: nothing is played by itself any more. */
  onInteract: () => void
}

/**
 * The candidates the add-ons offer for one film or episode, filling in as
 * the answers arrive: grouped by add-on, each candidate's name and text as
 * the add-on wrote them. Arrow keys move between candidates, Enter plays
 * one, Escape closes. A sheet on the app's `Modal`.
 */
export function AddonStreamPicker({
  itemName,
  picker,
  autoWaiting,
  mpvMissing,
  onChoose,
  onClose,
  onRetry,
  onOpenSettings,
  onInteract
}: AddonStreamPickerProps) {
  const sheetRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const phase: StreamPickerPhase = picker ? pickerPhase(picker) : 'asking'

  // Focus starts on the list (the sheet's first `data-autofocus`). The first
  // candidate takes it when it arrives, or the outcome's action when there
  // is none, unless the viewer has moved it somewhere else meanwhile.
  useEffect(() => {
    const list = listRef.current
    if (!list || document.activeElement !== list) return
    if (phase === 'ready') list.querySelector<HTMLElement>(`[${CANDIDATE_ATTRIBUTE}]`)?.focus()
    else if (phase === 'no-addons' || phase === 'all-failed') {
      sheetRef.current?.querySelector<HTMLElement>('[data-outcome-action]')?.focus()
    }
  }, [phase])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // The player answers keys on the window (volume, seek, leave); none of
    // them belongs to it while this is open.
    if (event.key !== 'Tab') event.stopPropagation()
    onInteract()
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    const list = listRef.current
    if (!list) return
    const buttons = [...list.querySelectorAll<HTMLElement>(`[${CANDIDATE_ATTRIBUTE}]`)]
    const index = buttons.findIndex((button) => button === document.activeElement)
    const next = nextCandidateIndex(event.key, index, buttons.length)
    if (next === null) return
    event.preventDefault()
    // Focusing scrolls the candidate into view.
    buttons[next]?.focus()
  }

  return (
    // The sheet is a portal; its events still bubble here through React, the
    // header's close button's included, so the keys are handled in one place.
    <div className="contents" onKeyDown={onKeyDown} onPointerDown={onInteract}>
      <Modal isOpen onClose={onClose} title={text.title} className="max-w-[760px] min-[1800px]:max-w-[900px]">
        <div ref={sheetRef} className="flex flex-col gap-4">
          <p className="-mt-2 line-clamp-2 break-words text-base text-surface-300">{itemName}</p>

          {mpvMissing && (
            <p className="flex items-start gap-2.5 text-[15px] text-surface-300">
              <AlertTriangle size={18} className="mt-0.5 shrink-0 text-sun" aria-hidden="true" />
              {text.html5Warning}
            </p>
          )}

          <div aria-live="polite" className="empty:hidden">
            {autoWaiting && <StatusLine spinner>{text.autoWaiting}</StatusLine>}
            {!autoWaiting && phase === 'asking' && <StatusLine spinner>{text.asking}</StatusLine>}
          </div>

          {phase === 'no-addons' && (
            <Outcome
              title={text.noAddons}
              hint={text.noAddonsHint}
              action={
                <Button variant="primary" onClick={onOpenSettings} data-outcome-action>
                  {text.openSettings}
                </Button>
              }
            />
          )}
          {phase === 'none-found' && <Outcome title={text.noneFound} hint={text.noneFoundHint} />}
          {phase === 'all-failed' && (
            <Outcome
              title={text.allFailed}
              hint={text.allFailedHint}
              action={
                <Button variant="primary" onClick={onRetry} data-outcome-action>
                  {strings.common.retry}
                </Button>
              }
            />
          )}

          {/* Always there, so the focus it takes when the sheet opens is not lost when the answers arrive. */}
          <div
            ref={listRef}
            tabIndex={-1}
            role="group"
            aria-label={text.listLabel}
            data-autofocus
            className={`-mx-1.5 flex max-h-[min(58vh,620px)] flex-col gap-5 overflow-y-auto px-1.5 outline-none ${picker?.addons.length ? 'py-1.5' : '-mt-4'}`}
          >
            {picker?.addons.map((addon) => (
              <AddonGroup key={addon.sourceId} addon={addon} onChoose={onChoose} />
            ))}
          </div>
        </div>
      </Modal>
    </div>
  )
}

function StatusLine({ spinner, children }: { spinner?: boolean; children: ReactNode }) {
  return (
    <p role="status" className="flex items-center gap-2.5 text-[15px] text-surface-300">
      {spinner && <Spinner size={16} />}
      {children}
    </p>
  )
}

function Outcome({ title, hint, action }: { title: string; hint: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-card bg-ground px-5 py-4">
      <p className="font-title text-[22px] leading-[1.2] text-white">{title}</p>
      <p className="text-[15px] leading-6 text-surface-400">{hint}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

function addonStatusText(addon: PickerAddon): string {
  switch (addon.status) {
    case 'asking':
      return text.addonAsking
    case 'candidates':
      return text.candidateCount(addon.candidates.length)
    case 'empty':
      return text.addonEmpty
    case 'failed':
      return text.addonFailed(addon.error ?? '')
  }
}

function AddonGroup({ addon, onChoose }: { addon: PickerAddon; onChoose: (candidate: AddonStreamCandidate) => void }) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <div className="flex min-w-0 items-baseline justify-between gap-4 px-1">
        <h3 id={headingId} className="min-w-0 truncate text-[17px] font-bold text-white" title={addon.addonName}>
          {addon.addonName}
        </h3>
        <span
          className={`flex shrink-0 items-center gap-2 text-sm ${addon.status === 'failed' ? 'max-w-[60%] text-right text-surface-400' : 'text-surface-500'}`}
        >
          {addon.status === 'asking' && <Spinner size={13} />}
          <span className="line-clamp-2">{addonStatusText(addon)}</span>
        </span>
      </div>
      {addon.candidates.length > 0 && (
        <ul className="flex flex-col gap-2">
          {addon.candidates.map((candidate) => (
            <li key={candidate.handle}>
              <CandidateButton candidate={candidate} onChoose={onChoose} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function CandidateButton({
  candidate,
  onChoose
}: {
  candidate: AddonStreamCandidate
  onChoose: (candidate: AddonStreamCandidate) => void
}) {
  const name = candidate.name ?? text.unnamed
  const detail = candidate.description ?? candidate.filename
  return (
    <button
      type="button"
      {...{ [CANDIDATE_ATTRIBUTE]: '' }}
      onClick={() => onChoose(candidate)}
      title={detail ? `${name}\n${detail}` : name}
      className="flex w-full items-start gap-4 rounded-card bg-ground px-4 py-3 text-left transition-colors hover:bg-surface-800"
    >
      {/* As the add-on wrote them: line breaks kept, long text clamped. */}
      <span className="line-clamp-3 w-[clamp(96px,24%,180px)] shrink-0 whitespace-pre-line break-words text-[15px] font-bold leading-5 text-white">
        {name}
      </span>
      <span className="line-clamp-4 min-w-0 flex-1 whitespace-pre-line break-words text-sm leading-5 text-surface-300">
        {detail ?? ''}
      </span>
      {candidate.videoSize !== null && candidate.videoSize > 0 && (
        <span className="flex h-8 shrink-0 items-center rounded-full bg-raised px-3 text-sm font-bold tabular-nums text-white">
          {text.size(candidate.videoSize)}
        </span>
      )}
    </button>
  )
}
