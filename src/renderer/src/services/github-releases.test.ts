import { describe, expect, it } from 'vitest'
import { parseReleaseBody, parseReleaseList } from './github-releases'

describe('parseReleaseList', () => {
  const release = {
    id: 1,
    tag_name: 'v0.4.15-beta',
    name: 'Abi Player 0.4.15-beta',
    body: 'Notlar\n- bir',
    published_at: '2026-10-01T10:00:00Z',
    prerelease: true,
    draft: false,
    html_url: 'https://github.com/x/y/releases/tag/v0.4.15-beta'
  }

  it('maps published releases and skips drafts', () => {
    expect(parseReleaseList([release, { ...release, id: 2, draft: true }])).toEqual([
      {
        id: 1,
        tag: 'v0.4.15-beta',
        title: 'Abi Player 0.4.15-beta',
        publishedAt: '2026-10-01T10:00:00Z',
        isPrerelease: true,
        url: release.html_url,
        blocks: [
          { kind: 'heading', text: 'Notlar' },
          { kind: 'list', items: ['bir'] }
        ]
      }
    ])
  })

  it('skips entries without the fields the UI needs and fills optional ones', () => {
    const notes = parseReleaseList([
      { id: 'x', tag_name: 'v1', html_url: 'u' },
      { id: 3, html_url: 'u' },
      null,
      { id: 4, tag_name: 'v2', html_url: 'u', name: null, body: 5, published_at: 0 }
    ])
    expect(notes).toEqual([
      { id: 4, tag: 'v2', title: 'v2', publishedAt: null, isPrerelease: false, url: 'u', blocks: [] }
    ])
  })

  it('rejects a response that is not a list', () => {
    // GitHub answers a rate limit with an object, which used to crash on .filter.
    expect(() => parseReleaseList({ message: 'API rate limit exceeded' })).toThrow(
      'GitHub sürüm listesi okunamadı: beklenmeyen yanıt'
    )
    expect(() => parseReleaseList(null)).toThrow('GitHub sürüm listesi okunamadı')
  })
})

describe('parseReleaseBody', () => {
  it('parses the shape release-win.mjs actually publishes', () => {
    const blocks = parseReleaseBody(
      [
        'Abi Player 0.4.14-beta sürümü hazır.',
        '',
        'Öne Çıkanlar',
        '- Ekran uykusu engellendi',
        '- Tek instance kilidi',
        '',
        'Notlar',
        '- Windows kurulum dosyasını içerir'
      ].join('\n')
    )

    expect(blocks).toEqual([
      { kind: 'paragraph', text: 'Abi Player 0.4.14-beta sürümü hazır.' },
      { kind: 'heading', text: 'Öne Çıkanlar' },
      { kind: 'list', items: ['Ekran uykusu engellendi', 'Tek instance kilidi'] },
      { kind: 'heading', text: 'Notlar' },
      { kind: 'list', items: ['Windows kurulum dosyasını içerir'] }
    ])
  })

  it('treats markdown hashes and asterisk bullets as headings and lists', () => {
    const blocks = parseReleaseBody(['## Değişiklikler', '* ilk', '* ikinci'].join('\n'))

    expect(blocks).toEqual([
      { kind: 'heading', text: 'Değişiklikler' },
      { kind: 'list', items: ['ilk', 'ikinci'] }
    ])
  })

  it('keeps a sentence before a list as a paragraph, not a heading', () => {
    // Ends with a period, so it reads as prose even though a list follows.
    const blocks = parseReleaseBody(['Bu sürümde şunlar değişti.', '- bir şey'].join('\n'))

    expect(blocks[0]).toEqual({ kind: 'paragraph', text: 'Bu sürümde şunlar değişti.' })
  })

  it('returns nothing for an empty body', () => {
    expect(parseReleaseBody('')).toEqual([])
    expect(parseReleaseBody('\n\n  \n')).toEqual([])
  })
})
