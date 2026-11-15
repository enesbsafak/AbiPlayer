import { itemAt } from '../../../shared/checked'
import { GITHUB_REPO } from '@/constants/app-info'
import { errors } from '@/strings/errors'

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

/** A release entry with the required fields checked; the rest is unverified. */
interface GithubReleaseResponse {
  id: number
  tag_name: string
  html_url: string
  name?: unknown
  body?: unknown
  published_at?: unknown
  prerelease?: unknown
  draft?: unknown
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
    const line = itemAt(lines, index).trim()

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
      throw new Error(errors.github.listFailed(response.status))
    }

    const data: unknown = await response.json().catch(() => null)
    return parseReleaseList(data)
  } finally {
    window.clearTimeout(timer)
  }
}

function isGithubRelease(value: unknown): value is GithubReleaseResponse {
  if (typeof value !== 'object' || value === null) return false
  const release = value as Record<string, unknown>
  return (
    typeof release.id === 'number' &&
    typeof release.tag_name === 'string' &&
    release.tag_name.length > 0 &&
    typeof release.html_url === 'string'
  )
}

/**
 * Turn the GitHub releases response into notes. The response is checked
 * rather than cast: a non-list answer (rate-limit or error object) is an
 * error, and entries missing the fields the UI needs are skipped.
 */
export function parseReleaseList(data: unknown): ReleaseNote[] {
  if (!Array.isArray(data)) {
    throw new Error(errors.github.badResponse)
  }

  return data
    .filter(isGithubRelease)
    .filter((release) => release.draft !== true)
    .map((release) => ({
      id: release.id,
      tag: release.tag_name,
      title: typeof release.name === 'string' && release.name ? release.name : release.tag_name,
      publishedAt: typeof release.published_at === 'string' ? release.published_at : null,
      isPrerelease: release.prerelease === true,
      url: release.html_url,
      blocks: parseReleaseBody(typeof release.body === 'string' ? release.body : '')
    }))
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
