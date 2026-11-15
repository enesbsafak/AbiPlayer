// Test clips, generated once with the bundled ffmpeg and cached under
// e2e/.cache (gitignored). Synthetic picture (testsrc2, which shows a running
// clock) and digital silence for every audio track, so nothing audible can
// play on the machine running the suite; nothing copyrighted, nothing downloaded.

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const require = createRequire(import.meta.url)

export interface MediaSet {
  dir: string
  /** 60 s, 640x360 H.264 + AAC MPEG-TS with a keyframe every 2 s. */
  liveTs: string
  /** The same clip cut into 2 s HLS segments, in playback order. */
  hlsSegments: string[]
  hlsSegmentSeconds: number
  liveSeconds: number
  /** 600 s, 320x180 MP4 with faststart, for VOD and resume. */
  filmMp4: string
  filmSeconds: number
  /** 300 s MKV: audio tracks tagged tur and eng, subtitle tracks tagged tur and eng. */
  multiMkv: string
  multiSeconds: number
}

export function ffmpegPath(): string {
  const path = require('ffmpeg-static') as string | null
  if (!path || !existsSync(path)) throw new Error('ffmpeg-static binary not found; run npm ci')
  return path
}

function run(binary: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-4000)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exited with ${code}: ${stderr}`))
    })
  })
}

const LIVE_SECONDS = 60
const FILM_SECONDS = 600
const MULTI_SECONDS = 300
const SEGMENT_SECONDS = 2
/** Silent stereo audio; tracks exist and decode, but carry no sound. */
const SILENCE = 'anullsrc=channel_layout=stereo:sample_rate=48000'

function subtitleFile(language: 'tur' | 'eng', seconds: number): string {
  const lines: string[] = []
  const stamp = (total: number) => {
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = total % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},000`
  }
  for (let index = 0; index * 5 < seconds; index += 1) {
    const start = index * 5
    const text = language === 'tur' ? `Türkçe altyazı satırı ${index + 1} — çığ, şeker, ılık` : `English subtitle line ${index + 1}`
    lines.push(`${index + 1}\n${stamp(start)} --> ${stamp(start + 4)}\n${text}\n`)
  }
  return lines.join('\n')
}

const RECIPE = {
  version: 2, // 2: silent audio
  liveSeconds: LIVE_SECONDS,
  filmSeconds: FILM_SECONDS,
  multiSeconds: MULTI_SECONDS,
  segmentSeconds: SEGMENT_SECONDS
}

function recipeHash(): string {
  return createHash('sha256').update(JSON.stringify(RECIPE)).digest('hex').slice(0, 12)
}

function describe(dir: string): MediaSet {
  const hlsDir = join(dir, 'hls')
  const hlsSegments = existsSync(hlsDir)
    ? readdirSync(hlsDir)
        .filter((name) => name.endsWith('.ts'))
        .sort()
        .map((name) => join(hlsDir, name))
    : []
  return {
    dir,
    liveTs: join(dir, 'live.ts'),
    hlsSegments,
    hlsSegmentSeconds: SEGMENT_SECONDS,
    liveSeconds: LIVE_SECONDS,
    filmMp4: join(dir, 'film.mp4'),
    filmSeconds: FILM_SECONDS,
    multiMkv: join(dir, 'multi.mkv'),
    multiSeconds: MULTI_SECONDS
  }
}

/** Generates the clips if the cache is missing or was made by another recipe. */
export async function ensureMedia(cacheRoot: string): Promise<MediaSet> {
  const dir = join(cacheRoot, `media-${recipeHash()}`)
  const stampFile = join(dir, 'complete.json')
  if (existsSync(stampFile)) {
    const set = describe(dir)
    if (set.hlsSegments.length > 0) return set
  }

  rmSync(dir, { recursive: true, force: true })
  mkdirSync(join(dir, 'hls'), { recursive: true })
  const ffmpeg = ffmpegPath()
  const keyframes = ['-g', '50', '-keyint_min', '50', '-sc_threshold', '0', '-force_key_frames', `expr:gte(t,n_forced*${SEGMENT_SECONDS})`]

  await run(ffmpeg, [
    '-hide_banner', '-y',
    '-f', 'lavfi', '-i', `testsrc2=size=640x360:rate=25:duration=${LIVE_SECONDS}`,
    '-t', String(LIVE_SECONDS), '-f', 'lavfi', '-i', SILENCE,
    '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'main', '-pix_fmt', 'yuv420p',
    '-b:v', '700k', '-maxrate', '700k', '-bufsize', '1400k', ...keyframes,
    '-c:a', 'aac', '-b:a', '96k', '-ac', '2',
    '-metadata:s:a:0', 'language=tur',
    '-f', 'mpegts', 'live.ts'
  ], dir)

  await run(ffmpeg, [
    '-hide_banner', '-y', '-i', 'live.ts', '-c', 'copy', '-map', '0',
    '-f', 'hls', '-hls_time', String(SEGMENT_SECONDS), '-hls_list_size', '0',
    '-hls_segment_filename', join('hls', 'seg%03d.ts'), join('hls', 'index.m3u8')
  ], dir)

  await run(ffmpeg, [
    '-hide_banner', '-y',
    '-f', 'lavfi', '-i', `testsrc2=size=320x180:rate=25:duration=${FILM_SECONDS}`,
    '-t', String(FILM_SECONDS), '-f', 'lavfi', '-i', SILENCE,
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-b:v', '180k', ...keyframes,
    '-c:a', 'aac', '-b:a', '64k', '-ac', '2',
    '-movflags', '+faststart', 'film.mp4'
  ], dir)

  writeFileSync(join(dir, 'tur.srt'), subtitleFile('tur', MULTI_SECONDS))
  writeFileSync(join(dir, 'eng.srt'), subtitleFile('eng', MULTI_SECONDS))
  await run(ffmpeg, [
    '-hide_banner', '-y',
    '-f', 'lavfi', '-i', `testsrc2=size=320x180:rate=25:duration=${MULTI_SECONDS}`,
    '-t', String(MULTI_SECONDS), '-f', 'lavfi', '-i', SILENCE,
    '-t', String(MULTI_SECONDS), '-f', 'lavfi', '-i', SILENCE,
    '-i', 'tur.srt', '-i', 'eng.srt',
    '-map', '0:v', '-map', '1:a', '-map', '2:a', '-map', '3:s', '-map', '4:s',
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-b:v', '180k', ...keyframes,
    '-c:a', 'aac', '-b:a', '64k', '-ac', '2', '-c:s', 'srt',
    '-metadata:s:a:0', 'language=tur', '-metadata:s:a:0', 'title=Türkçe',
    '-metadata:s:a:1', 'language=eng', '-metadata:s:a:1', 'title=English',
    '-metadata:s:s:0', 'language=tur', '-metadata:s:s:0', 'title=Türkçe',
    '-metadata:s:s:1', 'language=eng', '-metadata:s:s:1', 'title=English',
    'multi.mkv'
  ], dir)

  writeFileSync(stampFile, JSON.stringify({ ...RECIPE, createdAt: new Date().toISOString() }, null, 2))
  return describe(dir)
}

export function readMedia(set: MediaSet) {
  return {
    liveTs: readFileSync(set.liveTs),
    hlsSegments: set.hlsSegments.map((file) => readFileSync(file))
  }
}
