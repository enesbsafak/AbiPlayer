import { describe, expect, it } from 'vitest'
import { normalizeSearchText } from './text-normalize'

describe('normalizeSearchText', () => {
  it('lowercases ASCII while keeping it searchable', () => {
    expect(normalizeSearchText('TRT 1')).toBe('trt 1')
    expect(normalizeSearchText('CNN Türk')).toBe('cnn türk')
  })

  it('folds dotted and dotless i forms so both spellings match', () => {
    // "IZLE" → tr-locale "ızle" → folded "izle". Matches a channel listed as "izle".
    expect(normalizeSearchText('IZLE')).toBe('izle')
    expect(normalizeSearchText('izle')).toBe('izle')
    expect(normalizeSearchText('İZLE')).toBe('izle')
  })

  it('normalizes city names with Turkish I', () => {
    expect(normalizeSearchText('Istanbul')).toBe('istanbul')
    expect(normalizeSearchText('İSTANBUL')).toBe('istanbul')
    expect(normalizeSearchText('istanbul')).toBe('istanbul')
    expect(normalizeSearchText('İstanbul')).toBe('istanbul')
  })

  it('keeps other Turkish characters intact', () => {
    expect(normalizeSearchText('YILDIZ TV')).toBe('yildiz tv') // Y I L D I Z → y ı l d ı z → fold → y i l d i z
    expect(normalizeSearchText('Güneş')).toBe('güneş')
    expect(normalizeSearchText('Şeker')).toBe('şeker')
  })
})
