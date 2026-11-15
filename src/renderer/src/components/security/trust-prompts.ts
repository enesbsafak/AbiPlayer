import { create } from 'zustand'
import type { UntrustedCertificateNotice } from '@/services/platform'
import {
  enqueuePrompt,
  hostOf,
  noticeKey,
  PENDING_SOURCE_TTL_MS,
  type PendingSource,
  type TrustPrompt
} from './certificate-trust'

/*
 * Small shared state between the add-source forms, the trust dialog and the
 * settings list, kept outside the app store on purpose: none of it is
 * persisted and none of it belongs to a slice.
 */

const pending: PendingSource[] = []

/** Remembers that the user just submitted a form adding a source at `url`. */
export function notePendingSource(url: string, resubmit: () => boolean, now = Date.now()): void {
  const host = hostOf(url)
  if (!host) return
  for (let i = pending.length - 1; i >= 0; i -= 1) {
    if (pending[i].host === host || now - pending[i].submittedAt > PENDING_SOURCE_TTL_MS) pending.splice(i, 1)
  }
  pending.push({ host, submittedAt: now, resubmit })
}

export function pendingSources(): PendingSource[] {
  return [...pending]
}

export function clearPendingSources(): void {
  pending.length = 0
}

type PromptListener = (notice: UntrustedCertificateNotice) => void
const promptListeners = new Set<PromptListener>()

/** Asks the mounted trust dialog to show this notice (from the settings list). */
export function requestTrustPrompt(notice: UntrustedCertificateNotice): void {
  for (const listener of promptListeners) listener(notice)
}

export function onTrustPromptRequest(listener: PromptListener): () => void {
  promptListeners.add(listener)
  return () => promptListeners.delete(listener)
}

const changeListeners = new Set<() => void>()

/** Something was trusted or revoked; lists showing pins should reload. */
export function notifyTrustChanged(): void {
  for (const listener of changeListeners) listener()
}

export function onTrustChanged(listener: () => void): () => void {
  changeListeners.add(listener)
  return () => changeListeners.delete(listener)
}

/**
 * The trust dialog's queue and "Vazgeç" memory. Outside the component so the
 * shell switching between its player and normal layouts (which remounts the
 * dialog host) neither drops a question nor asks it twice.
 */
export interface TrustPromptState {
  queue: TrustPrompt[]
  dismissedAt: Record<string, number>
  enqueue: (prompt: TrustPrompt) => void
  /** Removes the prompt on screen; `dismissed` remembers the user said no. */
  resolveFirst: (dismissed: boolean) => void
}

export const useTrustPrompts = create<TrustPromptState>()((set) => ({
  queue: [],
  dismissedAt: {},
  enqueue: (prompt) => set((state) => ({ queue: enqueuePrompt(state.queue, prompt) })),
  resolveFirst: (dismissed) =>
    set((state) => {
      const [first, ...rest] = state.queue
      if (!first) return state
      const dismissedAt = { ...state.dismissedAt }
      if (dismissed) dismissedAt[noticeKey(first.notice)] = Date.now()
      else delete dismissedAt[noticeKey(first.notice)]
      return { queue: rest, dismissedAt }
    })
}))
