/*
 * Encryption of cached M3U data.
 *
 * M3U entry URLs usually carry the account name and password (Xtream-made
 * playlists put both in every URL), cannot be derived from anything else, and
 * the record ids, logos and EPG URL of a playlist are made from or point at
 * the same URLs. So the cache never stores an M3U chunk in clear: the whole
 * chunk is sealed with AES-GCM. The key is generated once by the main process
 * and kept in the operating system's secure storage next to the stored
 * logins; the worker gets the raw bytes in memory only and derives two
 * non-extractable keys from them (HKDF): one to encrypt, one to name chunks
 * (HMAC), so even a chunk's key says nothing about its content.
 */

export interface SealedBlob {
  iv: Uint8Array
  data: ArrayBuffer
}

export interface CacheCipher {
  /** Short public identifier of the key; a cache sealed under another key is discarded. */
  readonly keyId: string
  seal(value: unknown): Promise<SealedBlob>
  open<T>(blob: SealedBlob): Promise<T>
  /** Keyed name for a chunk of sealed content. */
  name(text: string): Promise<string>
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function hex(bytes: ArrayBuffer, length: number): string {
  return Array.from(new Uint8Array(bytes).slice(0, length), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function createCacheCipher(rawKey: ArrayBuffer | Uint8Array): Promise<CacheCipher> {
  const material = rawKey instanceof Uint8Array ? rawKey : new Uint8Array(rawKey)
  if (material.byteLength < 32) throw new Error('Önbellek anahtarı geçersiz')
  const subtle = globalThis.crypto.subtle
  const base = await subtle.importKey('raw', material as BufferSource, 'HKDF', false, ['deriveKey'])
  const salt = encoder.encode('abi-player catalog cache v1')
  const encryptionKey = await subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: encoder.encode('encrypt') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
  const namingKey = await subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: encoder.encode('name') },
    base,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign']
  )
  const name = async (text: string) => hex(await subtle.sign('HMAC', namingKey, encoder.encode(text)), 16)
  const keyId = await name('key-id')

  return {
    keyId,
    async seal(value) {
      const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
      const data = await subtle.encrypt({ name: 'AES-GCM', iv }, encryptionKey, encoder.encode(JSON.stringify(value)))
      return { iv, data }
    },
    async open<T>(blob: SealedBlob) {
      const plain = await subtle.decrypt({ name: 'AES-GCM', iv: blob.iv as BufferSource }, encryptionKey, blob.data)
      return JSON.parse(decoder.decode(plain)) as T
    },
    name
  }
}
