import { createHash } from 'crypto'
import { readdir, unlink } from 'fs/promises'
import { join } from 'path'
import { writeFileAtomic } from '../ipc/atomic-file'

const BUNDLE_PATTERN = /^ca-[0-9a-f]{16}\.pem$/

/**
 * CA files for mpv (`tls-ca-file`) and ffmpeg (`-ca_file`): the operating
 * system's trusted roots plus, for one host, the certificate the user pinned.
 * One file per distinct content, named by its hash, written once; a pinned
 * certificate only ever appears in the bundle of its own host's loads, so it
 * cannot vouch for anything else.
 */
export class CaBundles {
  private readonly written = new Map<string, Promise<string>>()

  constructor(
    private readonly dir: string,
    private readonly systemRoots: () => readonly string[]
  ) {}

  fileFor(extraPems: readonly string[] = []): Promise<string> {
    const content = [...this.systemRoots(), ...extraPems].map((pem) => pem.trim()).join('\n') + '\n'
    const name = `ca-${createHash('sha256').update(content).digest('hex').slice(0, 16)}.pem`
    let pending = this.written.get(name)
    if (!pending) {
      const path = join(this.dir, name)
      pending = writeFileAtomic(path, content).then(() => path)
      // A failed write is retried by the next load rather than cached.
      pending.catch(() => this.written.delete(name))
      this.written.set(name, pending)
    }
    return pending
  }

  /** Removes bundles left by earlier runs (they may hold revoked pins). */
  async removeStale(): Promise<void> {
    let names: string[]
    try {
      names = await readdir(this.dir)
    } catch {
      return
    }
    await Promise.all(
      names
        .filter((name) => BUNDLE_PATTERN.test(name) && !this.written.has(name))
        .map((name) => unlink(join(this.dir, name)).catch(() => undefined))
    )
  }
}
