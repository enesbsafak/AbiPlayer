import { describe, expect, it } from 'vitest'
import {
  findProgress,
  isCompleted,
  isTrackableChannel,
  MAX_ENTRIES,
  progressKeyFor,
  redactStreamUrl,
  removeProgress,
  restoreStreamUrl,
  resumePositionFor,
  sanitizeProgressEntries,
  shouldStoreProgress,
  toProgressChannel,
  upsertProgress,
  wouldRewindPendingResume,
  type WatchProgressEntry
} from './watch-progress'

const XTREAM_URL = 'http://tv.example.com:8080/movie/ahmet/s3cret/1234.mkv'
const REDACTED_URL = 'http://tv.example.com:8080/movie/~abi~/~abi~/1234.mkv'

function entry(key: string, position = 600, updatedAt = 1): WatchProgressEntry {
  return {
    key,
    position,
    duration: 3600,
    updatedAt,
    channel: { id: key, name: `Film ${key}`, streamUrl: key, sourceId: 's1', type: 'vod' }
  }
}

describe('credential redaction', () => {
  it('strips the username and password out of an Xtream stream URL', () => {
    expect(redactStreamUrl(XTREAM_URL)).toBe(REDACTED_URL)
    expect(redactStreamUrl(XTREAM_URL)).not.toContain('s3cret')
  })

  it('redacts live and series paths too', () => {
    expect(redactStreamUrl('http://h/series/u/p/9.mp4')).toBe('http://h/series/~abi~/~abi~/9.mp4')
    expect(redactStreamUrl('http://h/live/u/p/9.m3u8')).toBe('http://h/live/~abi~/~abi~/9.m3u8')
  })

  it('leaves non-Xtream URLs untouched', () => {
    const plain = 'http://cdn.example.com/vod/film.mp4'
    expect(redactStreamUrl(plain)).toBe(plain)
    expect(restoreStreamUrl(plain, null)).toBe(plain)
  })

  it('rebuilds the playable URL from live credentials', () => {
    expect(restoreStreamUrl(REDACTED_URL, { username: 'ahmet', password: 's3cret' })).toBe(
      XTREAM_URL
    )
  })

  it('refuses to rebuild when the source is gone', () => {
    expect(restoreStreamUrl(REDACTED_URL, null)).toBeNull()
    expect(restoreStreamUrl(REDACTED_URL, { username: 'ahmet', password: '' })).toBeNull()
  })

  it('keys and stores channels without ever holding a credential', () => {
    expect(progressKeyFor({ streamUrl: XTREAM_URL })).toBe(REDACTED_URL)

    const stored = toProgressChannel({
      id: 'vod_1',
      name: 'Film',
      streamUrl: XTREAM_URL,
      sourceId: 's1',
      type: 'vod'
    })
    expect(stored.streamUrl).toBe(REDACTED_URL)
    expect(JSON.stringify(stored)).not.toContain('s3cret')
  })

  it('matches a stored entry against a freshly built URL', () => {
    // The catalog hands over a full URL; the stored key is redacted. They must
    // still resolve to the same entry.
    const list = [{ ...entry('x'), key: REDACTED_URL }]
    expect(findProgress(list, { streamUrl: XTREAM_URL })?.key).toBe(REDACTED_URL)
  })
})

describe('isTrackableChannel', () => {
  it('tracks VOD and episodes but never live', () => {
    expect(isTrackableChannel({ type: 'vod', streamUrl: 'http://x/1.mkv' })).toBe(true)
    expect(isTrackableChannel({ type: 'series', streamUrl: 'http://x/1.mkv' })).toBe(true)
    expect(isTrackableChannel({ type: 'live', streamUrl: 'http://x/live' })).toBe(false)
  })

  it('rejects a channel with no stream url to key on', () => {
    expect(isTrackableChannel({ type: 'vod', streamUrl: '' })).toBe(false)
    expect(isTrackableChannel({ type: 'vod', streamUrl: '   ' })).toBe(false)
  })
})

describe('shouldStoreProgress', () => {
  it('ignores the opening seconds', () => {
    expect(shouldStoreProgress(12, 3600)).toBe(false)
    expect(shouldStoreProgress(31, 3600)).toBe(true)
  })

  it('drops a title once it is effectively finished', () => {
    // 92% of a 3600s title is 3312s.
    expect(shouldStoreProgress(3300, 3600)).toBe(true)
    expect(shouldStoreProgress(3350, 3600)).toBe(false)
  })

  it('refuses positions with no usable duration', () => {
    expect(shouldStoreProgress(500, 0)).toBe(false)
    expect(shouldStoreProgress(500, Number.POSITIVE_INFINITY)).toBe(false)
    expect(shouldStoreProgress(Number.NaN, 3600)).toBe(false)
  })
})

describe('isCompleted', () => {
  it('treats an unknown duration as unfinished', () => {
    expect(isCompleted(500, 0)).toBe(false)
    expect(isCompleted(500, Number.NaN)).toBe(false)
  })
})

describe('resumePositionFor', () => {
  it('rewinds a few seconds for context', () => {
    expect(resumePositionFor(entry('a', 600))).toBe(595)
  })

  it('never returns a negative position', () => {
    expect(resumePositionFor(entry('a', 2))).toBe(0)
  })
})

describe('upsertProgress', () => {
  it('moves an updated entry to the front instead of duplicating it', () => {
    const list = upsertProgress([entry('a'), entry('b')], entry('b', 900, 2))

    expect(list.map((item) => item.key)).toEqual(['b', 'a'])
    expect(list[0].position).toBe(900)
  })

  it('caps the list so localStorage cannot grow without bound', () => {
    let list: WatchProgressEntry[] = []
    for (let index = 0; index < MAX_ENTRIES + 5; index += 1) {
      list = upsertProgress(list, entry(`k${index}`))
    }

    expect(list).toHaveLength(MAX_ENTRIES)
    expect(list[0].key).toBe(`k${MAX_ENTRIES + 4}`)
  })
})

describe('findProgress / removeProgress', () => {
  it('matches on stream url, which stays stable across sessions', () => {
    const list = [entry('http://x/1.mkv')]
    // A series episode gets a new channel id every play; the URL does not.
    expect(findProgress(list, { streamUrl: 'http://x/1.mkv' })?.key).toBe('http://x/1.mkv')
    expect(findProgress(list, { streamUrl: 'http://x/2.mkv' })).toBeNull()
  })

  it('removes by key', () => {
    expect(removeProgress([entry('a'), entry('b')], 'a').map((item) => item.key)).toEqual(['b'])
  })
})

describe('sanitizeProgressEntries', () => {
  it('keeps well-formed entries', () => {
    const stored = [entry('a')]
    expect(sanitizeProgressEntries(stored)).toEqual(stored)
  })

  it('drops anything that is not a usable entry', () => {
    expect(sanitizeProgressEntries(null)).toEqual([])
    expect(sanitizeProgressEntries('nope')).toEqual([])
    expect(sanitizeProgressEntries([null, 42, { key: 'a' }])).toEqual([])
    expect(sanitizeProgressEntries([{ ...entry('a'), position: 'x' }])).toEqual([])
    expect(sanitizeProgressEntries([{ ...entry('a'), channel: { name: 'x' } }])).toEqual([])
  })

  it('rejects payloads that would render as NaN', () => {
    expect(sanitizeProgressEntries([{ ...entry('a'), duration: 0 }])).toEqual([])
    expect(sanitizeProgressEntries([{ ...entry('a'), duration: -5 }])).toEqual([])
    expect(sanitizeProgressEntries([{ ...entry('a'), position: -1 }])).toEqual([])
  })

  it('rejects a live entry the recorder could never have written', () => {
    const live = entry('a')
    expect(
      sanitizeProgressEntries([{ ...live, channel: { ...live.channel, type: 'live' } }])
    ).toEqual([])
  })

  it('redacts a raw credential URL restored from an older payload', () => {
    const [restored] = sanitizeProgressEntries([
      {
        key: XTREAM_URL,
        position: 100,
        duration: 3600,
        channel: { name: 'Film', streamUrl: XTREAM_URL, type: 'vod' }
      }
    ])

    expect(restored.channel.streamUrl).toBe(REDACTED_URL)
  })

  it('fills missing optional channel fields rather than dropping the entry', () => {
    const [restored] = sanitizeProgressEntries([
      {
        key: 'http://x/1.mkv',
        position: 100,
        duration: 3600,
        channel: { name: 'Film', streamUrl: 'http://x/1.mkv', type: 'vod' }
      }
    ])

    expect(restored.channel.id).toBe('http://x/1.mkv')
    expect(restored.channel.sourceId).toBe('')
    expect(restored.updatedAt).toBe(0)
  })
})

describe('wouldRewindPendingResume', () => {
  const saved = [entry(REDACTED_URL, 1800)]
  const channel = { streamUrl: XTREAM_URL }

  it('blocks a lower position while the resume for that stream is still pending', () => {
    expect(wouldRewindPendingResume(saved, channel, 40, XTREAM_URL)).toBe(true)
  })

  it('lets a higher position through even while pending', () => {
    expect(wouldRewindPendingResume(saved, channel, 1900, XTREAM_URL)).toBe(false)
  })

  it('does not block once no resume is pending, or when another stream is pending', () => {
    expect(wouldRewindPendingResume(saved, channel, 40, null)).toBe(false)
    expect(wouldRewindPendingResume(saved, channel, 40, 'http://h/movie/u/p/other.mkv')).toBe(false)
  })

  it('does not block a stream with nothing saved', () => {
    expect(wouldRewindPendingResume([], channel, 40, XTREAM_URL)).toBe(false)
  })
})
