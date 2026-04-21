import { afterEach, describe, expect, it, vi } from 'vitest'
import { maskCredentialsInUrl, xtreamApi } from './xtream-api'

// Give every test a unique url+user so it hits a distinct cache key and
// doesn't collide with state left behind by previous tests.
let testSeq = 0
function uniqueCreds() {
  testSeq += 1
  return {
    url: `http://example-${testSeq}.com`,
    username: `user${testSeq}`,
    password: 'pass'
  }
}

describe('xtream-api', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('aborts in-flight requests when the caller aborts the signal', async () => {
    const creds = uniqueCreds()
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

  it('shares an in-flight request between concurrent callers without a signal', async () => {
    const creds = uniqueCreds()
    let resolveFetch: ((value: Response) => void) | null = null
    const fetchMock = vi.fn(() => {
      return new Promise<Response>((resolve) => {
        resolveFetch = resolve
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const first = xtreamApi.getLiveStreams(creds)
    const second = xtreamApi.getLiveStreams(creds)

    // Let the first call's async body run up to its `await fetch(...)`.
    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    resolveFetch!(new Response('[]', { status: 200 }))

    await expect(first).resolves.toEqual([])
    await expect(second).resolves.toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not piggy-back signal-owning callers on each other', async () => {
    // Regression guard for a React Strict Mode double-mount race: the first
    // mount aborts mid-flight, and if the second mount shares the cancelled
    // promise it sees a spurious "İstek iptal edildi" error. Each signal-
    // owning caller must get its own fetch.
    const creds = uniqueCreds()
    let callCount = 0
    const resolvers: Array<(value: Response) => void> = []
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      const s = init?.signal
      const idx = callCount++
      return new Promise<Response>((resolve, reject) => {
        resolvers[idx] = resolve
        s?.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true }
        )
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const firstController = new AbortController()
    const secondController = new AbortController()

    const first = xtreamApi.getLiveStreams(creds, undefined, { signal: firstController.signal })
    const second = xtreamApi.getLiveStreams(creds, undefined, { signal: secondController.signal })

    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    // First caller aborts — only THEIR fetch is cancelled.
    firstController.abort()
    await expect(first).rejects.toThrow('İstek iptal edildi')

    // Second caller's fetch is still live and can complete normally.
    resolvers[1]!(new Response('[]', { status: 200 }))
    await expect(second).resolves.toEqual([])
  })

  it('masks credentials from HTTP error bodies', async () => {
    const creds = uniqueCreds()
    const fetchMock = vi.fn(() => {
      return Promise.resolve(
        new Response(
          `Upstream error for http://echo.example/player_api.php?username=${creds.username}&password=secret`,
          { status: 500, statusText: 'Internal Server Error' }
        )
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    const rejected = xtreamApi.getLiveStreams(creds).catch((err: Error) => err.message)
    const message = await rejected
    expect(typeof message).toBe('string')
    expect(message).toContain('username=***')
    expect(message).toContain('password=***')
    expect(message).not.toContain(creds.username)
    expect(message).not.toContain('secret')
  })
})

describe('maskCredentialsInUrl', () => {
  it('masks username/password query params', () => {
    const masked = maskCredentialsInUrl(
      'http://host.example/player_api.php?username=alice&password=secret&action=x'
    )
    expect(masked).toContain('username=***')
    expect(masked).toContain('password=***')
    expect(masked).not.toContain('alice')
    expect(masked).not.toContain('secret')
  })

  it('masks positional /live/<user>/<pass>/<id> paths', () => {
    const masked = maskCredentialsInUrl('https://host.example/live/alice/secret/1234.m3u8')
    expect(masked).toBe('https://host.example/live/***/***/1234.m3u8')
  })

  it('is resilient to malformed URLs', () => {
    const masked = maskCredentialsInUrl(
      'not a url but has username=alice&password=secret in it'
    )
    expect(masked).toContain('username=***')
    expect(masked).toContain('password=***')
  })
})
