/*
 * Splitting a list into cache chunks so that a refresh rewrites only what
 * changed.
 *
 * Every record gets a cheap 53-bit content hash (its id is part of the
 * content). Chunk boundaries are content-defined: a chunk ends after a record
 * whose hash hits a fixed pattern (or at the size cap), so inserting or
 * removing one record moves at most the boundaries next to it, and every
 * other chunk comes out byte-identical with the same key as before. A chunk
 * whose key is already stored is not written again.
 *
 * Pure and synchronous: runs in the worker.
 */

/** cyrb53: a fast, well-mixed 53-bit string hash (not cryptographic). */
export function hash53(text: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

export function recordHash(record: unknown): number {
  return hash53(JSON.stringify(record))
}

export interface ChunkingOptions {
  /** No boundary before this many records. */
  minSize: number
  /** A boundary is forced at this many records. */
  maxSize: number
  /** Expected spacing of content-defined boundaries above `minSize` (a power of two). */
  spacing: number
}

export const DEFAULT_CHUNKING: ChunkingOptions = { minSize: 256, maxSize: 4096, spacing: 1024 }

export interface PlannedChunk<T> {
  records: T[]
  /** Content identity of the chunk: equal records in equal order give an equal id. */
  contentId: string
}

/** Splits `records` (in order) into content-defined chunks. */
export function planChunks<T>(records: readonly T[], options: ChunkingOptions = DEFAULT_CHUNKING): PlannedChunk<T>[] {
  const chunks: PlannedChunk<T>[] = []
  const mask = options.spacing - 1
  let current: T[] = []
  let hashes: string[] = []

  const close = () => {
    if (current.length === 0) return
    const joined = hashes.join(',')
    chunks.push({ records: current, contentId: `${hash53(joined).toString(36)}${hash53(joined, 0x9e3779b9).toString(36)}-${current.length}` })
    current = []
    hashes = []
  }

  for (const record of records) {
    const hash = recordHash(record)
    current.push(record)
    hashes.push(hash.toString(36))
    // The low bits of a 53-bit hash: `% 2**32` keeps them exact.
    const low = hash % 4294967296
    if (current.length >= options.maxSize || (current.length >= options.minSize && (low & mask) === mask)) close()
  }
  close()
  return chunks
}

/** Fixed-size slices (posting to the main thread, EPG chunks). */
export function slices<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}
