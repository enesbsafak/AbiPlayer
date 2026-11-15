// @vitest-environment node
import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MEDIA_JOB_CANCELLED_MESSAGE } from '../../shared/ipc/contract'
import {
  MEDIA_PROTOCOL_WHITELIST,
  MediaJobRunner,
  createMediaService,
  finalizeExtraction,
  parseMediaJobOptions,
  resolveMediaTimeout,
  type MediaChildProcess
} from './media-jobs'

class FakeChild extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  killed = false
  kill = vi.fn(() => {
    this.killed = true
    // A killed process closes with a null exit code, after its pipes drain.
    setImmediate(() => this.emit('close', null))
    return true
  })

  out(text: string): void {
    this.stdout.write(text)
  }

  err(text: string): void {
    this.stderr.write(text)
  }

  exit(code: number): void {
    setImmediate(() => this.emit('close', code))
  }
}

function setup() {
  const children: FakeChild[] = []
  const spawn = vi.fn((_executable: string, _args: string[]) => {
    const child = new FakeChild()
    children.push(child)
    return child as unknown as MediaChildProcess
  })
  const runner = new MediaJobRunner(spawn)
  const media = createMediaService({ runner, ffprobePath: 'ffprobe', ffmpegPath: 'ffmpeg' })
  return { children, spawn, runner, media }
}

const flush = () => new Promise((resolve) => setImmediate(resolve))

const URL_WITH_CREDS = 'http://p.example/movie/ali/s3cret/9.mkv'

describe('media jobs', () => {
  it('passes a protocol whitelist to ffprobe and ffmpeg', async () => {
    const { children, spawn, media } = setup()

    const probe = media.probe('w1', URL_WITH_CREDS)
    children[0].out('{"streams":[{"index":2,"codec_name":"subrip","tags":{"language":" TUR "}}]}')
    children[0].exit(0)
    await expect(probe).resolves.toEqual([{ index: 2, codec: 'subrip', language: 'tur', title: undefined }])

    const probeArgs = spawn.mock.calls[0][1]
    expect(probeArgs.slice(probeArgs.indexOf('-protocol_whitelist'), probeArgs.indexOf('-protocol_whitelist') + 2)).toEqual([
      '-protocol_whitelist',
      MEDIA_PROTOCOL_WHITELIST
    ])
    expect(probeArgs.indexOf('-protocol_whitelist')).toBeLessThan(probeArgs.indexOf(URL_WITH_CREDS))

    const extract = media.extract('w1', URL_WITH_CREDS, 2)
    children[1].out('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nMerhaba\n\n')
    children[1].exit(0)
    await expect(extract).resolves.toEqual({
      format: 'vtt',
      content: 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nMerhaba\n\n',
      truncated: false
    })
    const extractArgs = spawn.mock.calls[1][1]
    expect(extractArgs.indexOf('-protocol_whitelist')).toBeLessThan(extractArgs.indexOf('-i'))
  })

  it('masks credentials in ffprobe and ffmpeg error output', async () => {
    const { children, media } = setup()

    const probe = media.probe('w1', URL_WITH_CREDS)
    children[0].err(`${URL_WITH_CREDS}: Server returned 401 Unauthorized`)
    children[0].exit(1)
    const probeError = await probe.catch((error: Error) => error)
    expect(probeError).toBeInstanceOf(Error)
    expect((probeError as Error).message).toBe('http://p.example/movie/***/***/9.mkv: Server returned 401 Unauthorized')

    const extract = media.extract('w1', URL_WITH_CREDS, 2)
    children[1].err(`${URL_WITH_CREDS}: Server returned 403 Forbidden`)
    children[1].exit(1)
    await expect(extract).rejects.toThrow('http://p.example/movie/***/***/9.mkv: Server returned 403 Forbidden')
  })

  it('starting a new job kills the previous one of the same window', async () => {
    const { children, media } = setup()

    const first = media.probe('w1', URL_WITH_CREDS)
    const second = media.extract('w1', URL_WITH_CREDS, 3)

    await expect(first).rejects.toThrow(MEDIA_JOB_CANCELLED_MESSAGE)
    expect(children[0].kill).toHaveBeenCalledWith('SIGKILL')
    expect(children[1].kill).not.toHaveBeenCalled()

    children[1].out('00:00:01.000 --> 00:00:02.000\nA\n\n')
    children[1].exit(0)
    await expect(second).resolves.toMatchObject({ truncated: false })
  })

  it('does not touch jobs of another window', async () => {
    const { children, media } = setup()
    const other = media.probe('w2', URL_WITH_CREDS)
    void media.probe('w1', URL_WITH_CREDS).catch(() => undefined)

    expect(children[0].kill).not.toHaveBeenCalled()
    children[0].out('{}')
    children[0].exit(0)
    await expect(other).resolves.toEqual([])
  })

  it('cancels a job by id, or every job of the window without one', async () => {
    const { children, media, runner } = setup()

    const job = media.probe('w1', URL_WITH_CREDS, { jobId: 'probe-7' })
    expect(media.cancel('w1', 'other-id')).toBe(false)
    expect(media.cancel('w2', 'probe-7')).toBe(false)
    expect(media.cancel('w1', 'probe-7')).toBe(true)
    await expect(job).rejects.toThrow(MEDIA_JOB_CANCELLED_MESSAGE)
    expect(children[0].kill).toHaveBeenCalled()

    const next = media.extract('w1', URL_WITH_CREDS, 1)
    expect(media.cancel('w1')).toBe(true)
    await expect(next).rejects.toThrow(MEDIA_JOB_CANCELLED_MESSAGE)
    await flush()
    expect(runner.runningCount).toBe(0)
  })

  // Regression (M2): the bare Xtream live form has no /live/ prefix; the URL
  // the job was given tells which segments are the account.
  it('masks the account of the input URL in error output, whatever form ffmpeg prints it in', async () => {
    const { children, media } = setup()
    const LIVE_URL = 'http://h.example:8080/alice/s3cret/12345'

    const probe = media.probe('w1', LIVE_URL)
    children[0].err(`${LIVE_URL}: Server returned 404 Not Found`)
    children[0].exit(1)
    await expect(probe).rejects.toThrow('http://h.example:8080/***/***/12345: Server returned 404 Not Found')

    const extract = media.extract('w1', LIVE_URL, 2)
    children[1].err(
      "[hls @ 000001d8a6b0e3c0] Opening 'http://edge.example/hls/alice/s3cret/12345/index.m3u8' for reading\n" +
        'Error opening input file http://edge.example/hls/alice/s3cret/12345/index.m3u8.\n'
    )
    children[1].exit(1)
    const error = (await extract.catch((caught: Error) => caught)) as Error
    expect(error.message).not.toContain('alice')
    expect(error.message).not.toContain('s3cret')
    expect(error.message).toContain('Error opening input file http://edge.example/hls/***/***/12345/index.m3u8.')
  })

  it('reports a spawn failure', async () => {
    const { children, media } = setup()
    const probe = media.probe('w1', URL_WITH_CREDS)
    children[0].emit('error', new Error('spawn ffprobe ENOENT'))
    await expect(probe).rejects.toThrow('ENOENT')
  })

  it('returns no tracks when ffprobe is not available', async () => {
    const runner = new MediaJobRunner(vi.fn())
    const media = createMediaService({ runner, ffprobePath: null, ffmpegPath: null })
    await expect(media.probe('w1', URL_WITH_CREDS)).resolves.toEqual([])
    await expect(media.extract('w1', URL_WITH_CREDS, 1)).rejects.toThrow('ffmpeg')
  })

  describe('limits', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('fails a probe that runs past its timeout', async () => {
      const { children, media } = setup()
      const probe = media.probe('w1', URL_WITH_CREDS, { timeoutMs: 5000 })
      vi.advanceTimersByTime(5000)
      await expect(probe).rejects.toThrow('zaman aşımına uğradı (5000ms)')
      expect(children[0].kill).toHaveBeenCalled()
    })

    // Regression (F1-11): a time-limited partial extraction used to come back
    // looking exactly like a complete one.
    it('marks an extraction stopped by the time limit as truncated and drops the half-written cue', async () => {
      const { children, media } = setup()
      const extract = media.extract('w1', URL_WITH_CREDS, 2)
      children[0].out('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nBir\n\n00:00:03.000 --> 00:00:0')
      await flush()
      vi.advanceTimersByTime(45_000)

      await expect(extract).resolves.toEqual({
        format: 'vtt',
        content: 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nBir\n\n',
        truncated: true
      })
    })
  })
})

describe('finalizeExtraction', () => {
  it('marks output cut by the size limit as truncated', () => {
    expect(
      finalizeExtraction({ stdout: '00:00:01.000 --> 00:00:02.000\nA\n\n', stderr: '', exitCode: null, stoppedBy: 'output-limit' })
    ).toEqual({ format: 'vtt', content: 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nA\n\n', truncated: true })
  })

  it('marks cues followed by a stream failure as truncated', () => {
    expect(
      finalizeExtraction({ stdout: '00:00:01.000 --> 00:00:02.000\nA\n\n', stderr: 'boom', exitCode: 1, stoppedBy: null })
    ).toMatchObject({ truncated: true })
  })

  it('returns null when a stopped or clean run produced no cues', () => {
    expect(finalizeExtraction({ stdout: '', stderr: '', exitCode: 0, stoppedBy: null })).toBeNull()
    expect(finalizeExtraction({ stdout: 'WEBVTT\n\n', stderr: '', exitCode: null, stoppedBy: 'timeout' })).toBeNull()
  })
})

describe('job options', () => {
  it('validates job ids and timeouts', () => {
    expect(parseMediaJobOptions(undefined)).toEqual({})
    expect(parseMediaJobOptions({ jobId: 'abc_1-2', timeoutMs: 8000 })).toEqual({ jobId: 'abc_1-2', timeoutMs: 8000 })
    expect(() => parseMediaJobOptions({ jobId: 'bad id' })).toThrow('Geçersiz medya işi kimliği')
    expect(() => parseMediaJobOptions({ timeoutMs: Number.NaN })).toThrow('Geçersiz medya işi süresi')
    expect(() => parseMediaJobOptions('x')).toThrow()
  })

  it('clamps timeouts to 1–45 seconds', () => {
    expect(resolveMediaTimeout(undefined)).toBe(45_000)
    expect(resolveMediaTimeout(10)).toBe(1_000)
    expect(resolveMediaTimeout(120_000)).toBe(45_000)
  })
})

describe('media jobs and the TLS policy (F3-01)', () => {
  function setupWithTls(tlsArgs: (url: string) => Promise<string[]>) {
    const children: FakeChild[] = []
    const spawn = vi.fn((_executable: string, _args: string[]) => {
      const child = new FakeChild()
      children.push(child)
      return child as unknown as MediaChildProcess
    })
    const media = createMediaService({ runner: new MediaJobRunner(spawn), ffprobePath: 'ffprobe', ffmpegPath: 'ffmpeg', tlsArgs })
    return { children, spawn, media }
  }

  const HTTPS_URL = 'https://p.example/movie/u/p/9.mkv'

  it('puts the TLS arguments before the input of ffprobe and ffmpeg', async () => {
    const { children, spawn, media } = setupWithTls(async () => ['-tls_verify', '1', '-ca_file', '/certs/ca.pem'])

    const probe = media.probe('w1', HTTPS_URL)
    await vi.waitFor(() => expect(children).toHaveLength(1))
    const probeArgs = spawn.mock.calls[0][1]
    expect(probeArgs.indexOf('-tls_verify')).toBeGreaterThan(-1)
    expect(probeArgs.indexOf('-ca_file')).toBeLessThan(probeArgs.indexOf(HTTPS_URL))
    children[0].out('{"streams":[]}')
    children[0].exit(0)
    await probe

    const extract = media.extract('w1', HTTPS_URL, 2)
    await vi.waitFor(() => expect(children).toHaveLength(2))
    const extractArgs = spawn.mock.calls[1][1]
    expect(extractArgs.indexOf('-tls_verify')).toBeLessThan(extractArgs.indexOf('-i'))
    children[1].exit(0)
    await extract
  })

  // Regression (M3): the TLS check used to be awaited before the job was
  // registered, so a cancel in that window found nothing and the stale job
  // later ran and cancelled the newer one.
  describe('while the TLS check is pending', () => {
    function deferredTls() {
      const pending: { url: string; resolve(args: string[]): void; reject(error: Error): void }[] = []
      const tlsArgs = (url: string) =>
        new Promise<string[]>((resolve, reject) => {
          pending.push({ url, resolve, reject })
        })
      return { pending, tlsArgs }
    }

    it('a cancel by id or by window ends the job and nothing is started', async () => {
      const { pending, tlsArgs } = deferredTls()
      const { spawn, media } = setupWithTls(tlsArgs)

      const byId = media.probe('w1', HTTPS_URL, { jobId: 'probe-1' })
      await vi.waitFor(() => expect(pending).toHaveLength(1))
      expect(media.cancel('w1', 'probe-1')).toBe(true)
      await expect(byId).rejects.toThrow(MEDIA_JOB_CANCELLED_MESSAGE)

      // Window destroyed or renderer crashed: the owner's jobs are cancelled.
      const byWindow = media.extract('w1', HTTPS_URL, 2)
      await vi.waitFor(() => expect(pending).toHaveLength(2))
      expect(media.cancel('w1')).toBe(true)
      await expect(byWindow).rejects.toThrow(MEDIA_JOB_CANCELLED_MESSAGE)

      pending[0].resolve([])
      pending[1].resolve([])
      await flush()
      expect(spawn).not.toHaveBeenCalled()
    })

    it('shutdown cancels it', async () => {
      const { pending, tlsArgs } = deferredTls()
      const { spawn, media } = setupWithTls(tlsArgs)

      const probe = media.probe('w1', HTTPS_URL)
      const other = media.probe('w2', HTTPS_URL)
      await vi.waitFor(() => expect(pending).toHaveLength(2))
      media.cancelAll()
      await expect(probe).rejects.toThrow(MEDIA_JOB_CANCELLED_MESSAGE)
      await expect(other).rejects.toThrow(MEDIA_JOB_CANCELLED_MESSAGE)

      for (const entry of pending) entry.resolve([])
      await flush()
      expect(spawn).not.toHaveBeenCalled()
    })

    it('an older job whose check finishes late neither runs nor cancels the newer one', async () => {
      const { pending, tlsArgs } = deferredTls()
      const { children, spawn, media } = setupWithTls(tlsArgs)
      const OLD_URL = 'https://p.example/movie/u/p/1.mkv'
      const NEW_URL = 'https://p.example/movie/u/p/2.mkv'

      const older = media.probe('w1', OLD_URL)
      await vi.waitFor(() => expect(pending).toHaveLength(1))
      const newer = media.probe('w1', NEW_URL)
      await expect(older).rejects.toThrow(MEDIA_JOB_CANCELLED_MESSAGE)
      await vi.waitFor(() => expect(pending).toHaveLength(2))

      pending[1].resolve([])
      await vi.waitFor(() => expect(children).toHaveLength(1))
      pending[0].resolve([])
      await flush()

      expect(spawn).toHaveBeenCalledTimes(1)
      expect(spawn.mock.calls[0][1]).toContain(NEW_URL)
      expect(children[0].kill).not.toHaveBeenCalled()
      children[0].out('{"streams":[]}')
      children[0].exit(0)
      await expect(newer).resolves.toEqual([])
    })

    it('a refusal that arrives after a cancel changes nothing', async () => {
      const { pending, tlsArgs } = deferredTls()
      const { spawn, media } = setupWithTls(tlsArgs)

      const probe = media.probe('w1', HTTPS_URL)
      await vi.waitFor(() => expect(pending).toHaveLength(1))
      media.cancel('w1')
      pending[0].reject(new Error('Sunucunun güvenlik sertifikası değişti'))
      await expect(probe).rejects.toThrow(MEDIA_JOB_CANCELLED_MESSAGE)
      expect(spawn).not.toHaveBeenCalled()
    })
  })

  it('starts nothing when the policy refuses the URL', async () => {
    const { spawn, media } = setupWithTls(async () => {
      throw new Error('Sunucunun güvenlik sertifikası değişti')
    })
    await expect(media.probe('w1', HTTPS_URL)).rejects.toThrow('sertifika')
    await expect(media.extract('w1', HTTPS_URL, 1)).rejects.toThrow('sertifika')
    expect(spawn).not.toHaveBeenCalled()
  })
})
