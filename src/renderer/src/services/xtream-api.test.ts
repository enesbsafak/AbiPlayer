import { afterEach, describe, expect, it, vi } from 'vitest'
import { forgetXtreamRequests, xtreamApi } from './xtream-api'
import { XtreamRequestError } from './xtream-errors'
import { getAllowedLiveFormats, pickLiveFormat } from './xtream-normalize'
import { maskCredentialsInUrl, xtreamRetryDelayMs } from './xtream-request'
import type { XtreamAuthResponse } from '@/types/xtream'

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

    // maxRetries: 0 keeps the 5xx from being retried with real backoff delays.
    const rejected = xtreamApi.getLiveStreams(creds, undefined, { maxRetries: 0 }).catch((err: Error) => err.message)
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

async function captureError(promise: Promise<unknown>): Promise<XtreamRequestError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof XtreamRequestError) return error
    throw error
  }
  throw new Error('expected the request to fail')
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), { status: 200, ...init })
}

describe('xtream-api request layer', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('retries a transient 5xx with backoff and then succeeds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const creds = uniqueCreds()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(jsonResponse([{ stream_id: 1, name: 'Kanal' }]))
    vi.stubGlobal('fetch', fetchMock)

    const request = xtreamApi.getLiveStreams(creds)
    await vi.advanceTimersByTimeAsync(xtreamRetryDelayMs(1))

    await expect(request).resolves.toMatchObject([{ stream_id: 1, name: 'Kanal' }])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('gives up after maxRetries and reports a typed http error', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const creds = uniqueCreds()
    const fetchMock = vi.fn(() => Promise.resolve(new Response('', { status: 502 })))
    vi.stubGlobal('fetch', fetchMock)

    const errorPromise = captureError(xtreamApi.getLiveStreams(creds, undefined, { maxRetries: 1 }))
    await vi.advanceTimersByTimeAsync(xtreamRetryDelayMs(1))
    const error = await errorPromise

    expect(error.kind).toBe('http')
    expect(error.status).toBe(502)
    expect(error.message).toBe('Sunucu hata döndürdü (HTTP 502)')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry authentication failures', async () => {
    const creds = uniqueCreds()
    const fetchMock = vi.fn(() => Promise.resolve(new Response('', { status: 401 })))
    vi.stubGlobal('fetch', fetchMock)

    const error = await captureError(xtreamApi.getLiveStreams(creds))

    expect(error.kind).toBe('auth')
    expect(error.retryable).toBe(false)
    expect(error.message).toContain('Kimlik doğrulama başarısız')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not retry when the caller aborts, even during the backoff wait', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const creds = uniqueCreds()
    const fetchMock = vi.fn(() => Promise.resolve(new Response('', { status: 503 })))
    vi.stubGlobal('fetch', fetchMock)

    const controller = new AbortController()
    const errorPromise = captureError(
      xtreamApi.getLiveStreams(creds, undefined, { signal: controller.signal })
    )
    // Let the first attempt fail and enter its backoff sleep.
    await vi.advanceTimersByTimeAsync(10)
    controller.abort()
    await vi.advanceTimersByTimeAsync(xtreamRetryDelayMs(2) * 2)

    const error = await errorPromise
    expect(error.kind).toBe('aborted')
    expect(error.message).toBe('İstek iptal edildi')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('times out when the response headers never arrive', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const creds = uniqueCreds()
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const errorPromise = captureError(xtreamApi.getLiveStreams(creds, '5', { maxRetries: 0 }))
    await vi.advanceTimersByTimeAsync(20_000)
    const error = await errorPromise

    expect(error.kind).toBe('timeout')
    expect(error.message).toBe('İstek zaman aşımına uğradı: sunucu 20 saniye içinde yanıt vermedi')
  })

  it('gives whole-catalog calls a longer header window', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const creds = uniqueCreds()
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        })
      })
    )

    let settled = false
    const errorPromise = captureError(xtreamApi.getVodStreams(creds, undefined, { maxRetries: 0 })).finally(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(20_000)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(25_000)

    const error = await errorPromise
    expect(error.kind).toBe('timeout')
    expect(error.message).toContain('45 saniye')
  })

  it('lets a slow body finish as long as data keeps flowing', async () => {
    // The old single 20 s timer covered the body too, so a large catalog on a
    // slow link always failed. Here the body takes 45 s in total but never
    // pauses for more than 15 s.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const creds = uniqueCreds()
    const encoder = new TextEncoder()
    const pieces = ['[{"stream_id":1,', '"name":"Yavaş"}', ']']
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const piece = pieces.shift()
        if (piece === undefined) {
          controller.close()
          return
        }
        await new Promise((resolve) => setTimeout(resolve, 15_000))
        controller.enqueue(encoder.encode(piece))
      }
    })
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(body, { status: 200 }))))

    const request = xtreamApi.getLiveStreams(creds, undefined, { maxRetries: 0 })
    await vi.advanceTimersByTimeAsync(50_000)

    await expect(request).resolves.toMatchObject([{ stream_id: 1, name: 'Yavaş' }])
  })

  it('fails with a timeout when the body stalls', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const creds = uniqueCreds()
    const encoder = new TextEncoder()
    let sent = false
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent) return new Promise<void>(() => undefined)
        sent = true
        controller.enqueue(encoder.encode('[{"stream_id":1'))
        return undefined
      }
    })
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(body, { status: 200 }))))

    const errorPromise = captureError(xtreamApi.getLiveStreams(creds, undefined, { maxRetries: 0 }))
    await vi.advanceTimersByTimeAsync(30_000)
    const error = await errorPromise

    expect(error.kind).toBe('timeout')
    expect(error.message).toContain('veri gelmiyor')
  })

  it('reports a network failure as a retryable network error', async () => {
    const creds = uniqueCreds()
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))

    const error = await captureError(xtreamApi.getLiveStreams(creds, undefined, { maxRetries: 0 }))

    expect(error.kind).toBe('network')
    expect(error.retryable).toBe(true)
    expect(error.message).toBe('Sunucuya bağlanılamadı. İnternet bağlantısını ve sunucu adresini kontrol edin.')
  })

  it('names the host of a failed request, so a refused certificate can be recognised (C2c)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))
    const creds = { url: `https://Panel-${testSeq + 1}.Example:8443/`, username: 'u', password: 'p' }
    testSeq += 1

    const error = await captureError(xtreamApi.getLiveStreams(creds, undefined, { maxRetries: 0 }))

    expect(error.host).toBe(`panel-${testSeq}.example`)
    expect(error.message).not.toContain('Panel')
  })

  it('turns a non-JSON body into a bad-response error with a Turkish message', async () => {
    const creds = uniqueCreds()
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('<html>Bakım</html>', { status: 200 }))))

    const error = await captureError(xtreamApi.getLiveStreams(creds))

    expect(error.kind).toBe('bad-response')
    expect(error.message).toBe('Geçersiz sunucu yanıtı. JSON bekleniyordu: <html>Bakım</html>')
  })

  it('turns a list response that is not a list into a bad-response error', async () => {
    // Used to surface as "streams.map is not a function" deep in the UI.
    const creds = uniqueCreds()
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse({ error: 'unknown action' }))))

    const error = await captureError(xtreamApi.getLiveStreams(creds))

    expect(error.kind).toBe('bad-response')
    expect(error.message).toContain('Beklenmeyen sunucu yanıtı')
  })

  it('treats an empty object as an empty list', async () => {
    const creds = uniqueCreds()
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse({}))))

    await expect(xtreamApi.getVodStreams(creds, '7')).resolves.toEqual([])
  })

  it('caches small list responses but not large ones', async () => {
    const small = uniqueCreds()
    const smallFetch = vi.fn(() => Promise.resolve(jsonResponse([{ stream_id: 1, name: 'A' }])))
    vi.stubGlobal('fetch', smallFetch)
    await xtreamApi.getLiveStreams(small)
    await xtreamApi.getLiveStreams(small)
    expect(smallFetch).toHaveBeenCalledTimes(1)

    const large = uniqueCreds()
    const bigName = 'x'.repeat(2 * 1024 * 1024 + 10)
    const largeFetch = vi.fn(() => Promise.resolve(jsonResponse([{ stream_id: 1, name: bigName }])))
    vi.stubGlobal('fetch', largeFetch)
    await xtreamApi.getLiveStreams(large)
    await xtreamApi.getLiveStreams(large)
    expect(largeFetch).toHaveBeenCalledTimes(2)
  })

  it('goes to the panel again after a refresh the user asked for, for that account only (K16)', async () => {
    const refreshed = uniqueCreds()
    const other = uniqueCreds()
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse([{ category_id: '1', category_name: 'A', parent_id: 0 }])))
    vi.stubGlobal('fetch', fetchMock)
    await xtreamApi.getLiveCategories(refreshed)
    await xtreamApi.getLiveStreams(refreshed, '1')
    await xtreamApi.getLiveCategories(other)
    expect(fetchMock).toHaveBeenCalledTimes(3)

    forgetXtreamRequests(refreshed)
    await xtreamApi.getLiveCategories(refreshed)
    await xtreamApi.getLiveStreams(refreshed, '1')
    await xtreamApi.getLiveCategories(other)
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })

  it('normalizes the auth flag when the panel sends it as a string', async () => {
    const creds = uniqueCreds()
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse({
            user_info: { auth: '1', status: 'Active', allowed_output_formats: ['m3u8', 'ts'] },
            server_info: { timestamp_now: '1700000000' }
          })
        )
      )
    )

    const auth = await xtreamApi.authenticate(creds)

    expect(auth.user_info.auth).toBe(1)
    expect(auth.user_info.allowed_output_formats).toEqual(['m3u8', 'ts'])
    expect(auth.server_info.timestamp_now).toBe(1_700_000_000)
  })

  it('rejects an auth response without user_info as a bad response', async () => {
    const creds = uniqueCreds()
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse([]))))

    const error = await captureError(xtreamApi.authenticate(creds))

    expect(error.kind).toBe('bad-response')
    expect(error.message).toBe('Sunucu geçersiz kimlik doğrulama yanıtı döndürdü')
  })
})

describe('xtream-api stream URLs', () => {
  const creds = { url: 'http://panel.example:8080/', username: 'ali veli', password: 'p#a/ss?1' }

  it('encodes username and password path segments', () => {
    // A '#' used to cut the URL short and a '/' added a path segment.
    expect(xtreamApi.buildLiveUrl(creds, 42)).toBe(
      'http://panel.example:8080/live/ali%20veli/p%23a%2Fss%3F1/42.m3u8'
    )
    expect(xtreamApi.buildVodUrl(creds, 7, 'mkv')).toBe(
      'http://panel.example:8080/movie/ali%20veli/p%23a%2Fss%3F1/7.mkv'
    )
    expect(xtreamApi.buildSeriesUrl(creds, 9, 'mp4')).toBe(
      'http://panel.example:8080/series/ali%20veli/p%23a%2Fss%3F1/9.mp4'
    )
  })

  it('leaves plain credentials unchanged', () => {
    expect(xtreamApi.buildLiveUrl({ url: 'http://h', username: 'u', password: 'p' }, 1)).toBe(
      'http://h/live/u/p/1.m3u8'
    )
  })

  it('still masks encoded credentials', () => {
    expect(maskCredentialsInUrl(xtreamApi.buildLiveUrl(creds, 42))).toBe(
      'http://panel.example:8080/live/***/***/42.m3u8'
    )
  })

  it('builds live URLs in the requested format and keeps m3u8 as the default', () => {
    expect(xtreamApi.buildLiveUrl(creds, 5)).toMatch(/\/5\.m3u8$/)
    expect(xtreamApi.buildLiveUrl(creds, 5, 'ts')).toMatch(/\/5\.ts$/)
  })

  it('keeps credentials out of the catalog records (F4-02)', () => {
    const streams = [
      {
        num: 1, name: 'Kanal', stream_type: 'live', stream_id: 5, stream_icon: '', epg_channel_id: '',
        added: '', is_adult: false, category_id: '', category_ids: [], custom_sid: '', tv_archive: false,
        direct_source: '', tv_archive_duration: 0
      }
    ]
    const [record] = xtreamApi.liveStreamsToRecords(streams, 's')
    expect(record).toMatchObject({ id: 's_live_5', streamId: 5, streamUrl: '' })
    expect(JSON.stringify(record)).not.toContain('ali')
  })
})

describe('live output formats', () => {
  const withFormats = (formats: string[]): Pick<XtreamAuthResponse, 'user_info'> => ({
    user_info: {
      username: '', password: '', message: '', auth: 1, status: '', exp_date: '', is_trial: '',
      active_cons: '', created_at: '', max_connections: '', allowed_output_formats: formats
    }
  })

  it('lists only the formats the panel allows', () => {
    expect(getAllowedLiveFormats(withFormats(['ts']))).toEqual(['ts'])
    expect(getAllowedLiveFormats(withFormats(['m3u8', 'rtmp']))).toEqual(['m3u8'])
    expect(getAllowedLiveFormats(withFormats(['ts', 'm3u8']))).toEqual(['m3u8', 'ts'])
  })

  it('assumes both when the panel says nothing usable', () => {
    expect(getAllowedLiveFormats(withFormats([]))).toEqual(['m3u8', 'ts'])
    expect(getAllowedLiveFormats(withFormats(['rtmp']))).toEqual(['m3u8', 'ts'])
    expect(getAllowedLiveFormats(null)).toEqual(['m3u8', 'ts'])
  })

  it('picks the preferred format only when it is allowed', () => {
    expect(pickLiveFormat(['m3u8', 'ts'], 'ts')).toBe('ts')
    expect(pickLiveFormat(['m3u8'], 'ts')).toBe('m3u8')
    expect(pickLiveFormat(['ts'], 'm3u8')).toBe('ts')
  })
})
