import { randomBytes } from 'crypto'
import { mkdir, open, rename, unlink } from 'fs/promises'
import { dirname } from 'path'

export interface AtomicWriteOps {
  writeAndSync(path: string, data: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  unlink(path: string): Promise<void>
  mkdir(dir: string): Promise<void>
}

export const nodeAtomicWriteOps: AtomicWriteOps = {
  async writeAndSync(path, data) {
    const handle = await open(path, 'w')
    try {
      await handle.writeFile(data, 'utf-8')
      await handle.sync()
    } finally {
      await handle.close()
    }
  },
  rename: (from, to) => rename(from, to),
  unlink: (path) => unlink(path),
  mkdir: async (dir) => {
    await mkdir(dir, { recursive: true })
  }
}

/**
 * Writes `data` to a sibling temp file, flushes it, then renames it over
 * `filePath`. A crash or a full disk part-way leaves the previous file intact
 * instead of a truncated one.
 */
export async function writeFileAtomic(
  filePath: string,
  data: string,
  ops: AtomicWriteOps = nodeAtomicWriteOps
): Promise<void> {
  await ops.mkdir(dirname(filePath))
  const tempPath = `${filePath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`

  try {
    await ops.writeAndSync(tempPath, data)
    await ops.rename(tempPath, filePath)
  } catch (error) {
    await ops.unlink(tempPath).catch(() => undefined)
    throw error
  }
}
