import { describe, expect, it } from 'vitest'
import { createCacheCipher } from './cipher'

describe('cache cipher', () => {
  it('round-trips a value and does not open it with another key', async () => {
    const one = await createCacheCipher(new Uint8Array(32).fill(1))
    const two = await createCacheCipher(new Uint8Array(32).fill(2))
    const sealed = await one.seal({ url: 'http://p.test/live/ali/GizliSifre/1.ts' })

    expect(new TextDecoder('latin1').decode(sealed.data)).not.toContain('GizliSifre')
    expect(await one.open(sealed)).toEqual({ url: 'http://p.test/live/ali/GizliSifre/1.ts' })
    await expect(two.open(sealed)).rejects.toThrow()
    expect(one.keyId).not.toBe(two.keyId)
  })

  it('names content deterministically per key, and differently under another key', async () => {
    const one = await createCacheCipher(new Uint8Array(32).fill(1))
    const again = await createCacheCipher(new Uint8Array(32).fill(1))
    const two = await createCacheCipher(new Uint8Array(32).fill(2))
    expect(await one.name('live\nabc')).toBe(await again.name('live\nabc'))
    expect(await one.name('live\nabc')).not.toBe(await two.name('live\nabc'))
    expect(one.keyId).toBe(again.keyId)
  })

  it('refuses a short key', async () => {
    await expect(createCacheCipher(new Uint8Array(8))).rejects.toThrow()
  })
})
