import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState, type FormEvent } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PendingSourceCapture } from './PendingSourceCapture'
import { clearPendingSources, pendingSources } from './trust-prompts'

function FakeForm({ onSubmit }: { onSubmit: () => void }) {
  const [loading, setLoading] = useState(false)
  const [url, setUrl] = useState('')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    onSubmit()
    setLoading(true)
  }
  return (
    <form onSubmit={submit}>
      <input id="xtream-url" aria-label="Sunucu URL" value={url} onChange={(event) => setUrl(event.target.value)} />
      <button type="submit" disabled={loading}>
        Bağlan
      </button>
      <button type="button" onClick={() => setLoading(false)}>
        Bitti
      </button>
    </form>
  )
}

beforeEach(() => clearPendingSources())
afterEach(() => cleanup())

describe('PendingSourceCapture', () => {
  it('records the host being added and resubmits once the running attempt has finished', async () => {
    const onSubmit = vi.fn()
    render(
      <PendingSourceCapture urlFieldId="xtream-url">
        <FakeForm onSubmit={onSubmit} />
      </PendingSourceCapture>
    )
    fireEvent.change(screen.getByLabelText('Sunucu URL'), { target: { value: 'https://Panel.Example:8443' } })
    fireEvent.click(screen.getByRole('button', { name: 'Bağlan' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(pendingSources().map((entry) => entry.host)).toEqual(['panel.example'])

    // Consent arrives while the first attempt is still loading: wait for it.
    act(() => {
      expect(pendingSources()[0]?.resubmit()).toBe(true)
    })
    expect(onSubmit).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Bitti' }))
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2))
  })

  it('does not resubmit a form the user has edited since', () => {
    const onSubmit = vi.fn()
    render(
      <PendingSourceCapture urlFieldId="xtream-url">
        <FakeForm onSubmit={onSubmit} />
      </PendingSourceCapture>
    )
    fireEvent.change(screen.getByLabelText('Sunucu URL'), { target: { value: 'https://panel.example' } })
    fireEvent.click(screen.getByRole('button', { name: 'Bağlan' }))
    fireEvent.change(screen.getByLabelText('Sunucu URL'), { target: { value: 'https://other.example' } })
    expect(pendingSources()[0]?.resubmit()).toBe(false)
  })
})
