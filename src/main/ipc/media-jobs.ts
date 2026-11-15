import { randomUUID } from 'crypto'
import type { ChildProcessByStdio } from 'child_process'
import type { Readable } from 'stream'
import type {
  EmbeddedSubtitleExtractionResult,
  EmbeddedSubtitleProbeTrack
} from '../../shared/types/electron-ipc'
import { MEDIA_JOB_CANCELLED_MESSAGE, type MediaJobOptions } from '../../shared/ipc/contract'
import { maskCredentials } from '../../shared/mask-credentials'

export type MediaChildProcess = ChildProcessByStdio<null, Readable, Readable>
export type SpawnMediaProcess = (executable: string, args: string[]) => MediaChildProcess

/**
 * Everything HTTP(S) playback needs — including HLS segments (`crypto` for
 * AES-128) and a configured proxy — and nothing that reads local files or
 * talks other protocols.
 */
export const MEDIA_PROTOCOL_WHITELIST = 'http,https,tcp,tls,crypto,httpproxy'

export const MAX_MEDIA_JOB_TIMEOUT_MS = 45_000
const MIN_MEDIA_JOB_TIMEOUT_MS = 1_000
const STDERR_TAIL_BYTES = 64 * 1024
const PROBE_MAX_STDOUT_BYTES = 2 * 1024 * 1024
const EXTRACT_MAX_STDOUT_BYTES = 160 * 1024
const JOB_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

export type MediaStopReason = 'timeout' | 'output-limit'

export interface MediaRunSpec {
  executable: string
  args: string[]
  timeoutMs: number
  maxStdoutBytes: number
  /**
   * 'fail' rejects when a limit is hit; 'stop' ends the process and resolves
   * with whatever was read, marking `stoppedBy`.
   */
  onLimit: 'fail' | 'stop'
}

export interface MediaRunResult {
  stdout: string
  stderr: string
  exitCode: number | null
  stoppedBy: MediaStopReason | null
}

export class MediaJobCancelledError extends Error {
  constructor() {
    super(MEDIA_JOB_CANCELLED_MESSAGE)
    this.name = 'MediaJobCancelledError'
  }
}

interface RunningJob {
  owner: string
  cancel(): void
}

export function isValidMediaJobId(value: unknown): value is string {
  return typeof value === 'string' && JOB_ID_PATTERN.test(value)
}

export function parseMediaJobOptions(value: unknown): MediaJobOptions {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object') throw new Error('Geçersiz medya işi seçenekleri')
  const { jobId, timeoutMs } = value as MediaJobOptions
  if (jobId !== undefined && !isValidMediaJobId(jobId)) throw new Error('Geçersiz medya işi kimliği')
  if (timeoutMs !== undefined && (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs))) {
    throw new Error('Geçersiz medya işi süresi')
  }
  return { jobId, timeoutMs }
}

export function resolveMediaTimeout(requested: number | undefined): number {
  if (requested === undefined) return MAX_MEDIA_JOB_TIMEOUT_MS
  return Math.round(Math.max(MIN_MEDIA_JOB_TIMEOUT_MS, Math.min(MAX_MEDIA_JOB_TIMEOUT_MS, requested)))
}

/**
 * Runs ffprobe/ffmpeg as identifiable, cancellable jobs.
 *
 * Each job belongs to an owner (one per renderer). Starting a job cancels
 * every job the same owner still has running: the player only ever needs the
 * newest probe or extraction, and a stale one keeps a second connection to
 * the provider open — exactly what trips "max connections" limits.
 */
export class MediaJobRunner {
  private readonly jobs = new Map<string, RunningJob>()

  constructor(private readonly spawnProcess: SpawnMediaProcess) {}

  run(spec: MediaRunSpec, owner: string, jobId: string = randomUUID()): Promise<MediaRunResult> {
    this.cancel(owner)
    const key = jobKey(owner, jobId)

    return new Promise<MediaRunResult>((resolve, reject) => {
      let child: MediaChildProcess
      try {
        child = this.spawnProcess(spec.executable, spec.args)
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
        return
      }

      let stdout = ''
      let stderr = ''
      let stdoutBytes = 0
      let stoppedBy: MediaStopReason | null = null
      let settled = false

      const kill = (): void => {
        try {
          child.kill('SIGKILL')
        } catch {
          // already gone
        }
      }

      const finish = (): void => {
        clearTimeout(timer)
        if (this.jobs.get(key) === job) this.jobs.delete(key)
      }

      const fail = (error: Error): void => {
        if (settled) return
        settled = true
        finish()
        kill()
        reject(error)
      }

      const hitLimit = (reason: MediaStopReason): void => {
        if (settled || stoppedBy) return
        if (spec.onLimit === 'fail') {
          fail(
            new Error(
              reason === 'timeout'
                ? `İşlem zaman aşımına uğradı (${spec.timeoutMs}ms)`
                : 'İşlem çıktısı izin verilen boyutu aştı'
            )
          )
          return
        }
        stoppedBy = reason
        kill()
      }

      const job: RunningJob = {
        owner,
        cancel: () => fail(new MediaJobCancelledError())
      }
      this.jobs.set(key, job)

      const timer = setTimeout(() => hitLimit('timeout'), spec.timeoutMs)

      child.on('error', (error) => fail(error))

      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        if (settled || stoppedBy) return
        stdout += chunk
        stdoutBytes += Buffer.byteLength(chunk)
        if (stdoutBytes >= spec.maxStdoutBytes) hitLimit('output-limit')
      })

      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk: string) => {
        // Only the tail matters for an error message; keep it bounded.
        stderr += chunk
        if (stderr.length > STDERR_TAIL_BYTES) stderr = stderr.slice(-STDERR_TAIL_BYTES)
      })

      child.on('close', (code) => {
        if (settled) return
        settled = true
        finish()
        resolve({ stdout, stderr, exitCode: code, stoppedBy })
      })
    })
  }

  /** Cancels one job of `owner`, or all of them when `jobId` is omitted. */
  cancel(owner: string, jobId?: string): boolean {
    let cancelled = false
    for (const [key, job] of [...this.jobs]) {
      if (job.owner !== owner) continue
      if (jobId !== undefined && key !== jobKey(owner, jobId)) continue
      job.cancel()
      cancelled = true
    }
    return cancelled
  }

  cancelAll(): void {
    for (const job of [...this.jobs.values()]) job.cancel()
  }

  get runningCount(): number {
    return this.jobs.size
  }
}

function jobKey(owner: string, jobId: string): string {
  return `${owner}\u0000${jobId}`
}

/** `tlsArgs`: the TLS policy's arguments for this URL (src/main/tls), placed before the input. */
export function buildProbeArgs(streamUrl: string, tlsArgs: readonly string[] = []): string[] {
  return [
    '-v',
    'error',
    '-protocol_whitelist',
    MEDIA_PROTOCOL_WHITELIST,
    ...tlsArgs,
    '-show_streams',
    '-select_streams',
    's',
    '-print_format',
    'json',
    streamUrl
  ]
}

export function buildExtractArgs(streamUrl: string, streamIndex: number, tlsArgs: readonly string[] = []): string[] {
  return [
    '-v',
    'error',
    '-nostdin',
    '-protocol_whitelist',
    MEDIA_PROTOCOL_WHITELIST,
    ...tlsArgs,
    '-i',
    streamUrl,
    '-map',
    `0:${streamIndex}`,
    '-f',
    'webvtt',
    'pipe:1'
  ]
}

function processFailure(result: MediaRunResult, tool: string): Error {
  const detail = maskCredentials(result.stderr.trim())
  return new Error(detail || `${tool} ${result.exitCode ?? 'bilinmeyen'} koduyla sonlandı`)
}

function normalizeOptional(value: string | undefined, lowercase: boolean): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return lowercase ? trimmed.toLowerCase() : trimmed
}

export function parseProbeOutput(stdout: string): EmbeddedSubtitleProbeTrack[] {
  type FFProbeStream = { index?: number; codec_name?: string; tags?: Record<string, string> }
  const parsed = JSON.parse(stdout || '{}') as { streams?: FFProbeStream[] }
  const streams = Array.isArray(parsed.streams) ? parsed.streams : []

  return streams
    .filter((stream): stream is FFProbeStream & { index: number } => typeof stream.index === 'number')
    .map((stream) => ({
      index: stream.index,
      codec: stream.codec_name || 'unknown',
      language: normalizeOptional(stream.tags?.language || stream.tags?.lang, true),
      title: normalizeOptional(stream.tags?.title, false)
    }))
}

/** Drops a cue the process was killed in the middle of writing. */
function dropIncompleteTrailingCue(vtt: string): string {
  const normalized = vtt.replace(/\r\n/g, '\n')
  if (normalized.endsWith('\n\n')) return normalized
  const lastBreak = normalized.lastIndexOf('\n\n')
  if (lastBreak < 0) return normalized
  const trimmed = normalized.slice(0, lastBreak + 2)
  return trimmed.includes('-->') ? trimmed : normalized
}

export function finalizeExtraction(result: MediaRunResult): EmbeddedSubtitleExtractionResult | null {
  const hasCues = result.stdout.includes('-->')

  if (!hasCues) {
    if (result.exitCode === 0 || result.stoppedBy) return null
    throw processFailure(result, 'ffmpeg')
  }

  // Cut short by our limits, or the stream failed after some cues: either way
  // the caller must not treat this as the whole track.
  const truncated = result.stoppedBy !== null || result.exitCode !== 0
  const body = truncated ? dropIncompleteTrailingCue(result.stdout) : result.stdout
  const content = body.trim().startsWith('WEBVTT') ? body : `WEBVTT\n\n${body}`
  return { format: 'vtt', content, truncated }
}

export interface MediaServiceOptions {
  runner: MediaJobRunner
  ffprobePath: string | null
  ffmpegPath: string | null
  /** TLS arguments for the URL; may reject to refuse the run (certificate policy). */
  tlsArgs?: (streamUrl: string) => Promise<string[]>
}

export function createMediaService({ runner, ffprobePath, ffmpegPath, tlsArgs }: MediaServiceOptions) {
  return {
    async probe(owner: string, streamUrl: string, options: MediaJobOptions = {}): Promise<EmbeddedSubtitleProbeTrack[]> {
      if (!ffprobePath) return []
      const result = await runner.run(
        {
          executable: ffprobePath,
          args: buildProbeArgs(streamUrl, tlsArgs ? await tlsArgs(streamUrl) : []),
          timeoutMs: resolveMediaTimeout(options.timeoutMs),
          maxStdoutBytes: PROBE_MAX_STDOUT_BYTES,
          onLimit: 'fail'
        },
        owner,
        options.jobId
      )
      if (result.exitCode !== 0) throw processFailure(result, 'ffprobe')
      return parseProbeOutput(result.stdout)
    },

    async extract(
      owner: string,
      streamUrl: string,
      streamIndex: number,
      options: MediaJobOptions = {}
    ): Promise<EmbeddedSubtitleExtractionResult | null> {
      if (!ffmpegPath) throw new Error('ffmpeg çalıştırılabilir dosyası bulunamadı')
      const result = await runner.run(
        {
          executable: ffmpegPath,
          args: buildExtractArgs(streamUrl, streamIndex, tlsArgs ? await tlsArgs(streamUrl) : []),
          timeoutMs: resolveMediaTimeout(options.timeoutMs),
          maxStdoutBytes: EXTRACT_MAX_STDOUT_BYTES,
          onLimit: 'stop'
        },
        owner,
        options.jobId
      )
      return finalizeExtraction(result)
    },

    cancel(owner: string, jobId?: string): boolean {
      return runner.cancel(owner, jobId)
    },

    cancelAll(): void {
      runner.cancelAll()
    }
  }
}

export type MediaService = ReturnType<typeof createMediaService>
