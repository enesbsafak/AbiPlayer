import { describe, expect, it } from 'vitest'
import { parseReleaseBody } from './github-releases'

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
