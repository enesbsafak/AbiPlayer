// @vitest-environment node
import { mkdtemp, readdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nodeAtomicWriteOps, writeFileAtomic } from './atomic-file'
import { CredentialStore, type CredentialStoreFs, type SafeStorageLike } from './credential-store'

const PREFIX = 'enc:'

// Stand-in for Electron's safeStorage: reversible, and decryption fails for
// anything it did not encrypt, like DPAPI with another user's blob.
const fakeSafeStorage: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (plain) => Buffer.from(PREFIX + plain, 'utf-8'),
  decryptString: (encrypted) => {
    const text = encrypted.toString('utf-8')
    if (!text.startsWith(PREFIX)) throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.')
    return text.slice(PREFIX.length)
  }
}

const CRED = { url: 'http://p.example', username: 'ali', password: 's3cret' }

let dir: string
let filePath: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'abi-cred-'))
  filePath = join(dir, 'secure-credentials.dat')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('CredentialStore', () => {
  it('round-trips credentials through an encrypted file', async () => {
    const store = new CredentialStore({ filePath, safeStorage: fakeSafeStorage })
    await store.set('src-1', CRED)

    const raw = await readFile(filePath, 'utf-8')
    expect(raw).not.toContain('s3cret')
    expect(await new CredentialStore({ filePath, safeStorage: fakeSafeStorage }).getAll()).toEqual({ 'src-1': CRED })
  })

  it('keeps an M3U playlist URL next to the Xtream credentials (F3-02)', async () => {
    const store = new CredentialStore({ filePath, safeStorage: fakeSafeStorage })
    const playlist = { kind: 'm3u_url' as const, url: 'http://p.example/get.php?username=ali&password=s3cret' }
    await store.set('src-1', CRED)
    await store.set('m3u-1', playlist)

    expect(await readFile(filePath, 'utf-8')).not.toContain('get.php')
    expect(await new CredentialStore({ filePath, safeStorage: fakeSafeStorage }).getAll()).toEqual({
      'src-1': CRED,
      'm3u-1': playlist
    })
  })

  // Regression: an undecryptable file made every read throw, and set/delete
  // read first, so saving was locked out permanently.
  it('moves an undecryptable file aside, reports the loss once and keeps saving working', async () => {
    await writeFile(filePath, Buffer.from('not-ours').toString('base64'), 'utf-8')
    const onLoss = vi.fn()
    const store = new CredentialStore({
      filePath,
      safeStorage: fakeSafeStorage,
      onLoss,
      now: () => Date.UTC(2026, 10, 15, 12, 30, 0)
    })

    await expect(store.getAll()).resolves.toEqual({})
    await store.set('src-1', CRED)
    await expect(store.getAll()).resolves.toEqual({ 'src-1': CRED })

    const quarantined = 'secure-credentials.dat.unreadable-2026-11-15T12-30-00-000Z'
    expect((await readdir(dir)).sort()).toEqual([quarantined, 'secure-credentials.dat'].sort())
    expect(onLoss).toHaveBeenCalledTimes(1)
    expect(onLoss).toHaveBeenCalledWith({ lostAt: Date.UTC(2026, 10, 15, 12, 30, 0), reason: 'decrypt-failed', quarantinedAs: quarantined })
    expect(store.getLossNotice()?.reason).toBe('decrypt-failed')
  })

  it('quarantines a file that decrypts to something other than a JSON object', async () => {
    await writeFile(filePath, fakeSafeStorage.encryptString('[1,2').toString('base64'), 'utf-8')
    const store = new CredentialStore({ filePath, safeStorage: fakeSafeStorage })

    await expect(store.getAll()).resolves.toEqual({})
    expect(store.getLossNotice()?.reason).toBe('corrupt')
    await expect(store.delete('src-1')).resolves.toBeUndefined()
  })

  it('treats a missing or empty file as an empty store without reporting a loss', async () => {
    const store = new CredentialStore({ filePath, safeStorage: fakeSafeStorage })
    await expect(store.getAll()).resolves.toEqual({})
    await writeFile(filePath, '', 'utf-8')
    await expect(store.getAll()).resolves.toEqual({})
    expect(store.getLossNotice()).toBeNull()
  })

  it('does not quarantine on a transient read error', async () => {
    const busy = Object.assign(new Error('EBUSY'), { code: 'EBUSY' })
    const fs: CredentialStoreFs = { ...nodeAtomicWriteOps, readFile: () => Promise.reject(busy) }
    const store = new CredentialStore({ filePath, safeStorage: fakeSafeStorage, fs })

    await expect(store.getAll()).rejects.toThrow('EBUSY')
    expect(store.getLossNotice()).toBeNull()
  })

  it('refuses to work without OS encryption', async () => {
    const store = new CredentialStore({
      filePath,
      safeStorage: { ...fakeSafeStorage, isEncryptionAvailable: () => false }
    })
    await expect(store.set('src-1', CRED)).rejects.toThrow('Güvenli kimlik bilgisi saklama')
  })

  it('serialises concurrent writes so none is lost', async () => {
    const store = new CredentialStore({ filePath, safeStorage: fakeSafeStorage })
    await Promise.all(
      Array.from({ length: 8 }, (_, i) => store.set(`src-${i}`, { ...CRED, username: `user${i}` }))
    )
    expect(Object.keys(await store.getAll()).sort()).toEqual(
      Array.from({ length: 8 }, (_, i) => `src-${i}`).sort()
    )
  })

  it('stops waiting for a lock holder that never finishes', async () => {
    let calls = 0
    const fs: CredentialStoreFs = {
      ...nodeAtomicWriteOps,
      readFile: (path) => {
        calls += 1
        return calls === 1 ? new Promise<string>(() => undefined) : readFile(path, 'utf-8')
      }
    }
    const store = new CredentialStore({ filePath, safeStorage: fakeSafeStorage, fs, lockTimeoutMs: 20 })

    void store.getAll()
    await expect(store.getAll()).rejects.toThrow('Kimlik bilgisi kilidi zaman aşımına uğradı')
    await expect(store.set('src-1', CRED)).resolves.toBeUndefined()
  })
})

describe('catalog cache key (C2c)', () => {
  it('is made once, kept encrypted next to the logins, and never listed as a source', async () => {
    const store = new CredentialStore({ filePath, safeStorage: fakeSafeStorage })
    await store.set('src-1', CRED)
    const key = await store.getCacheKey()
    expect(Buffer.from(key, 'base64')).toHaveLength(32)

    const reopened = new CredentialStore({ filePath, safeStorage: fakeSafeStorage })
    expect(await reopened.getCacheKey()).toBe(key)
    expect(await reopened.getAll()).toEqual({ 'src-1': CRED })
    await reopened.delete('src-1')
    await reopened.set('src-2', CRED)
    expect(await new CredentialStore({ filePath, safeStorage: fakeSafeStorage }).getCacheKey()).toBe(key)
    expect(await readFile(filePath, 'utf-8')).not.toContain(key)
  })

  it('is lost with the logins when the file cannot be read, so the old cache becomes unreadable', async () => {
    const store = new CredentialStore({ filePath, safeStorage: fakeSafeStorage })
    const key = await store.getCacheKey()
    await writeFile(filePath, Buffer.from('not ours').toString('base64'), 'utf-8')

    const after = new CredentialStore({ filePath, safeStorage: fakeSafeStorage })
    const next = await after.getCacheKey()
    expect(next).not.toBe(key)
    expect(after.getLossNotice()).toMatchObject({ reason: 'decrypt-failed' })
  })

  it('is not handed out when secure storage is unavailable', async () => {
    const store = new CredentialStore({ filePath, safeStorage: { ...fakeSafeStorage, isEncryptionAvailable: () => false } })
    await expect(store.getCacheKey()).rejects.toThrow('Güvenli kimlik bilgisi saklama')
  })
})

describe('writeFileAtomic', () => {
  it('leaves the previous file intact and no temp file behind when the write fails', async () => {
    await writeFile(filePath, 'previous', 'utf-8')
    const failingOps = {
      ...nodeAtomicWriteOps,
      rename: () => Promise.reject(new Error('disk full'))
    }

    await expect(writeFileAtomic(filePath, 'next', failingOps)).rejects.toThrow('disk full')
    expect(await readFile(filePath, 'utf-8')).toBe('previous')
    expect(await readdir(dir)).toEqual(['secure-credentials.dat'])
  })

  it('replaces the file when the write succeeds', async () => {
    await writeFile(filePath, 'previous', 'utf-8')
    await writeFileAtomic(filePath, 'next')
    expect(await readFile(filePath, 'utf-8')).toBe('next')
    expect(await readdir(dir)).toEqual(['secure-credentials.dat'])
  })
})
