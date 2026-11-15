import type { FormEvent, ReactNode } from 'react'
import { notePendingSource } from './trust-prompts'

interface PendingSourceCaptureProps {
  /** id of the form's server URL input. */
  urlFieldId: string
  children: ReactNode
}

/**
 * Submits `form` again once its current attempt has finished, if that attempt
 * left the form as it was (it failed). A succeeding attempt clears or unmounts
 * the form, and then nothing is sent twice.
 */
function resubmitWhenIdle(form: HTMLFormElement, field: HTMLInputElement, submitted: string): boolean {
  const unchanged = () => form.isConnected && field.value === submitted
  if (!unchanged()) return false
  const button = form.querySelector('button[type="submit"]')
  if (!(button instanceof HTMLButtonElement) || !button.disabled) {
    form.requestSubmit()
    return true
  }
  // Still submitting (the forms disable their button while loading).
  const observer = new MutationObserver(() => {
    if (button.disabled) return
    observer.disconnect()
    if (unchanged()) form.requestSubmit()
  })
  observer.observe(button, { attributes: true, attributeFilter: ['disabled'] })
  return true
}

/**
 * Wraps an add-source form so a certificate refused while it is being
 * submitted counts as "a source the user is adding" (the trust dialog asks
 * about it), and so consent can submit the same form again.
 */
export function PendingSourceCapture({ urlFieldId, children }: PendingSourceCaptureProps) {
  const handleSubmitCapture = (event: FormEvent<HTMLDivElement>) => {
    const form = event.target
    if (!(form instanceof HTMLFormElement)) return
    const field = form.elements.namedItem(urlFieldId)
    if (!(field instanceof HTMLInputElement)) return
    const submitted = field.value
    notePendingSource(submitted, () => resubmitWhenIdle(form, field, submitted))
  }

  return <div onSubmitCapture={handleSubmitCapture}>{children}</div>
}
