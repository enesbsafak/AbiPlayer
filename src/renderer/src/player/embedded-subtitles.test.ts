import { describe, expect, it } from 'vitest'
import { MEDIA_JOB_CANCELLED_MESSAGE } from '../../../shared/ipc/contract'
import { TRUNCATED_SUBTITLE_NOTICE, activeCuesAt, loadEmbeddedSubtitle } from './embedded-subtitles'

const VTT = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nMerhaba\n'

describe('loadEmbeddedSubtitle', () => {
  it('parses the cues and flags an incomplete extraction', async () => {
    const complete = await loadEmbeddedSubtitle(() => Promise.resolve({ format: 'vtt', content: VTT }), () => true)
    expect(complete).toMatchObject({ kind: 'cues', notice: null })

    const partial = await loadEmbeddedSubtitle(
      () => Promise.resolve({ format: 'vtt', content: VTT, truncated: true }),
      () => true
    )
    expect(partial).toMatchObject({ kind: 'cues', notice: TRUNCATED_SUBTITLE_NOTICE })
    expect(partial.kind === 'cues' && partial.cues).toHaveLength(1)
  })

  it('treats a cancellation or a superseded result as stale, not as a failure', async () => {
    const cancelled = await loadEmbeddedSubtitle(
      () => Promise.reject(new Error(MEDIA_JOB_CANCELLED_MESSAGE)),
      () => true
    )
    expect(cancelled.kind).toBe('stale')
    const superseded = await loadEmbeddedSubtitle(() => Promise.resolve({ format: 'vtt', content: VTT }), () => false)
    expect(superseded.kind).toBe('stale')
    const failed = await loadEmbeddedSubtitle(() => Promise.reject(new Error('ffmpeg')), () => true)
    expect(failed.kind).toBe('failed')
  })

  it('reports a stream without cues as empty', async () => {
    expect(await loadEmbeddedSubtitle(() => Promise.resolve(null), () => true)).toEqual({ kind: 'empty' })
  })
})

describe('activeCuesAt', () => {
  it('returns the cues showing at that time, bounds included', () => {
    const cues = [
      { startTime: 1, endTime: 2, text: 'a' },
      { startTime: 2, endTime: 3, text: 'b' }
    ]
    expect(activeCuesAt(cues, 2).map((cue) => cue.text)).toEqual(['a', 'b'])
    expect(activeCuesAt(cues, 3.5)).toEqual([])
  })
})
