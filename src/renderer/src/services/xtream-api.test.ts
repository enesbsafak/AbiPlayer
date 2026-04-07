import { afterEach, describe, expect, it, vi } from 'vitest'
import { xtreamApi } from './xtream-api'

const creds = {
  url: 'http://example.com',
  username: 'user',
  password: 'pass'
}

describe('xtream-api', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('aborts in-flight requests when the caller aborts the signal', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      const signal = init?.signal

      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true }
        )
      })
    })

    vi.stubGlobal('fetch', fetchMock)

    const controller = new AbortController()
    const request = xtreamApi.getLiveStreams(creds, undefined, { signal: controller.signal })

    controller.abort()

    await expect(request).rejects.toThrow('İstek iptal edildi')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
  })
})
