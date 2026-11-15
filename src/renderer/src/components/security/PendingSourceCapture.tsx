import type { FormEvent, ReactNode } from 'react'
import { notePendingSource } from './trust-prompts'

interface PendingSourceCaptureProps {
  /** id of the form's server URL input. */
  urlFieldId: string
  children: ReactNode
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
    notePendingSource(submitted, () => {
      if (!form.isConnected || field.value !== submitted) return false
      form.requestSubmit()
      return true
    })
  }

  return <div onSubmitCapture={handleSubmitCapture}>{children}</div>
}
