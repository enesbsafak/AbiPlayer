import { useEffect, useState } from 'react'
import { Bug, ChevronDown, ExternalLink, Loader2, Star } from 'lucide-react'
import {
  APP_NAME,
  APP_VERSION,
  GITHUB_NEW_ISSUE_URL,
  GITHUB_RELEASES_URL,
  GITHUB_REPO_URL
} from '@/constants/app-info'
import { fetchReleaseNotes, type ReleaseNote } from '@/services/github-releases'
import { toUserMessage } from '@/services/user-error'
import { LOCALE, strings } from '@/strings'

const text = strings.settings.support

const CARD = 'rounded-lg border border-surface-800 bg-surface-900 p-5'
const LINK =
  'inline-flex items-center gap-2 rounded-lg border border-surface-700 bg-surface-950 px-3 py-2 text-sm text-surface-200 transition-colors hover:border-surface-600 hover:bg-surface-800 hover:text-surface-50'

function formatReleaseDate(value: string | null): string | null {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toLocaleDateString(LOCALE)
}

function ReleaseBlocks({ release }: { release: ReleaseNote }) {
  if (release.blocks.length === 0) {
    return <p className="text-sm text-surface-500">{text.noNotes}</p>
  }

  return (
    <div className="flex flex-col gap-3">
      {release.blocks.map((block, index) => {
        if (block.kind === 'heading') {
          return (
            <p key={index} className="text-sm font-medium text-surface-200">
              {block.text}
            </p>
          )
        }

        if (block.kind === 'list') {
          return (
            <ul key={index} className="flex flex-col gap-1.5">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex} className="flex gap-2 text-sm text-surface-400">
                  <span className="mt-1.5 size-1 shrink-0 rounded-full bg-surface-600" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          )
        }

        return (
          <p key={index} className="text-sm text-surface-400">
            {block.text}
          </p>
        )
      })}
    </div>
  )
}

function ReleaseNotes() {
  const [releases, setReleases] = useState<ReleaseNote[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let mounted = true
    setError(null)
    // Back to the loading row — a retry that left the previous `[]` in place
    // rendered an empty card and looked like the button did nothing.
    setReleases(null)

    fetchReleaseNotes({ refresh: reloadToken > 0 })
      .then((notes) => {
        if (!mounted) return
        setReleases(notes)
        setExpandedId(notes[0]?.id ?? null)
      })
      .catch((cause: unknown) => {
        if (!mounted) return
        setError(toUserMessage(cause, text.notesFailed))
      })

    return () => {
      mounted = false
    }
  }, [reloadToken])

  if (!releases && !error) {
    return (
      <p className="flex items-center gap-2 text-sm text-surface-500">
        <Loader2 size={14} className="animate-spin" />
        {text.notesLoading}
      </p>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-surface-400">{error}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setReloadToken((token) => token + 1)} className={LINK}>
            {strings.common.retry}
          </button>
          <a href={GITHUB_RELEASES_URL} target="_blank" rel="noreferrer" className={LINK}>
            <ExternalLink size={14} />
            {text.openOnGithub}
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {releases?.map((release) => {
        const isExpanded = release.id === expandedId
        const isInstalled = release.tag === `v${APP_VERSION}`
        const publishedAt = formatReleaseDate(release.publishedAt)

        return (
          <div key={release.id} className="overflow-hidden rounded-lg border border-surface-800">
            <button
              type="button"
              aria-expanded={isExpanded}
              onClick={() => setExpandedId((current) => (current === release.id ? null : release.id))}
              className="flex w-full items-center gap-3 bg-surface-950 px-4 py-3 text-left transition-colors hover:bg-surface-800"
            >
              <ChevronDown
                size={16}
                className={`shrink-0 text-surface-500 transition-transform ${isExpanded ? '' : '-rotate-90'}`}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-surface-100">
                  {release.tag}
                </span>
                {publishedAt && <span className="text-xs text-surface-500">{publishedAt}</span>}
              </span>
              {isInstalled && (
                <span className="shrink-0 rounded border border-accent/45 bg-accent/15 px-2 py-0.5 text-caption font-medium text-accent">
                  {text.installedVersion}
                </span>
              )}
            </button>

            {isExpanded && (
              <div className="border-t border-surface-800 px-4 py-4">
                <ReleaseBlocks release={release} />
                <a
                  href={release.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-4 inline-flex items-center gap-1.5 text-xs text-surface-500 transition-colors hover:text-surface-300"
                >
                  <ExternalLink size={12} />
                  {text.viewOnGithub}
                </a>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function SupportSettings() {
  return (
    <div className="flex flex-col gap-4">
      <div className={CARD}>
        <p className="text-sm font-medium text-white">{text.supportTitle}</p>
        <p className="mt-1 text-sm text-surface-400">
          {text.supportText(APP_NAME)}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <a href={GITHUB_REPO_URL} target="_blank" rel="noreferrer" className={LINK}>
            <Star size={14} />
            {text.star}
          </a>
          <a href={GITHUB_NEW_ISSUE_URL} target="_blank" rel="noreferrer" className={LINK}>
            <Bug size={14} />
            {text.reportIssue}
          </a>
        </div>
      </div>

      <div className={CARD}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-white">{text.releaseNotes}</p>
          <a
            href={GITHUB_RELEASES_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-surface-500 transition-colors hover:text-surface-300"
          >
            <ExternalLink size={12} />
            {text.allReleases}
          </a>
        </div>
        <ReleaseNotes />
      </div>
    </div>
  )
}
