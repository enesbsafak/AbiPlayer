import { GITHUB_REPO } from '@/constants/app-info'

const RELEASES_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=8`
const REQUEST_TIMEOUT_MS = 12_000

export interface ReleaseNote {
  id: number
  tag: string
  title: string
  publishedAt: string | null
  isPrerelease: boolean
  url: string
  blocks: ReleaseNoteBlock[]
}

export type ReleaseNoteBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'paragraph'; text: string }

interface GithubReleaseResponse {
  id: number
  tag_name: string
  name: string | null
  body: string | null
  published_at: string | null
  prerelease: boolean
  draft: boolean
  html_url: string
}

function isListLine(line: string): boolean {
  return /^[-*]\s+/.test(line)
}

function stripListMarker(line: string): string {
  return line.replace(/^[-*]\s+/, '').trim()
}

/**
 * Release notes here are written to a fixed shape — a lead sentence, a couple of
 * bare-word headings and dash lists (see scripts/release-win.mjs). That is far
 * short of markdown, so a full parser would be dead weight; this handles exactly
 * the shapes that actually appear and renders anything else as a paragraph.
 */
export function parseReleaseBody(body: string): ReleaseNoteBlock[] {
  const lines = body.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReleaseNoteBlock[] = []
  let pendingList: string[] = []

  const flushList = (): void => {
    if (pendingList.length === 0) return
    blocks.push({ kind: 'list', items: pendingList })
    pendingList = []
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim()

    if (!line) {
      flushList()
      continue
    }

    if (isListLine(line)) {
      pendingList.push(stripListMarker(line))
      continue
    }

    flushList()

    if (line.startsWith('#')) {
      const text = line.replace(/^#+\s*/, '').trim()
      if (text) blocks.push({ kind: 'heading', text })
      continue
    }

    // A standalone line introducing a list reads as a heading ("Öne Çıkanlar").
    const nextLine = lines[index + 1]?.trim() ?? ''
    if (isListLine(nextLine) && line.length <= 60 && !line.endsWith('.')) {
      blocks.push({ kind: 'heading', text: line })
      continue
    }

    blocks.push({ kind: 'paragraph', text: line })
  }

  flushList()
  return blocks
}

async function requestReleases(): Promise<ReleaseNote[]> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(RELEASES_URL, {
      signal: controller.signal,
      headers: { Accept: 'application/vnd.github+json' }
    })

    if (!response.ok) {
      throw new Error(`GitHub sürüm listesi alınamadı (${response.status})`)
    }

    const data = (await response.json()) as GithubReleaseResponse[]

    return data
      .filter((release) => !release.draft)
      .map((release) => ({
        id: release.id,
        tag: release.tag_name,
        title: release.name || release.tag_name,
        publishedAt: release.published_at,
        isPrerelease: release.prerelease,
        url: release.html_url,
        blocks: parseReleaseBody(release.body ?? '')
      }))
  } finally {
    window.clearTimeout(timer)
  }
}

let cached: Promise<ReleaseNote[]> | null = null

/**
 * Published notes do not change while the app is open, so one successful fetch
 * is kept for the session. Failures are never cached — the retry button depends
 * on the next call actually hitting the network again.
 */
export function fetchReleaseNotes(options: { refresh?: boolean } = {}): Promise<ReleaseNote[]> {
  if (options.refresh) cached = null

  if (!cached) {
    cached = requestReleases().catch((error: unknown) => {
      cached = null
      throw error
    })
  }

  return cached
}
