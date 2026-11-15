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
