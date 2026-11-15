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
import { ACTION, SettingsGroup } from './controls'

const text = strings.settings.support

function formatReleaseDate(value: string | null): string | null {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toLocaleDateString(LOCALE)
}

function ReleaseBlocks({ release }: { release: ReleaseNote }) {
  if (release.blocks.length === 0) {
    return <p className="text-[15px] text-surface-400">{text.noNotes}</p>
  }

  return (
    <div className="flex max-w-[68ch] flex-col gap-3">
      {release.blocks.map((block, index) => {
        if (block.kind === 'heading') {
          return (
            <p key={index} className="text-base font-bold text-white">
              {block.text}
            </p>
          )
        }

        if (block.kind === 'list') {
          return (
            <ul key={index} className="flex flex-col gap-1.5">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex} className="flex gap-3 text-[15px] text-surface-300">
                  <span aria-hidden="true" className="mt-[9px] size-1.5 shrink-0 rounded-full bg-sky" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          )
        }

        return (
          <p key={index} className="text-[15px] text-surface-300">
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
      <p className="flex items-center gap-3 rounded-card bg-raised px-5 py-4 text-[15px] text-surface-300">
        <Loader2 size={18} className="animate-spin" aria-hidden="true" />
        {text.notesLoading}
      </p>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col gap-4 rounded-card bg-raised px-5 py-4">
        <p className="flex items-start gap-2.5 text-[15px] text-white">
          <span aria-hidden="true" className="mt-[7px] size-2 shrink-0 rounded-full bg-coral" />
          {error}
        </p>
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={() => setReloadToken((token) => token + 1)} className={ACTION.secondary}>
            {strings.common.retry}
          </button>
          <a href={GITHUB_RELEASES_URL} target="_blank" rel="noreferrer" className={ACTION.secondary}>
            <ExternalLink size={16} aria-hidden="true" />
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
          <div key={release.id} className="overflow-hidden rounded-card bg-raised">
            <button
              type="button"
              aria-expanded={isExpanded}
              onClick={() => setExpandedId((current) => (current === release.id ? null : release.id))}
              className="flex min-h-[60px] w-full items-center gap-4 px-5 py-3 text-left transition-colors hover:bg-surface-800"
            >
              <ChevronDown
                size={20}
                aria-hidden="true"
                className={`shrink-0 text-surface-400 transition-transform ${isExpanded ? '' : '-rotate-90'}`}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-base font-bold text-white">{release.tag}</span>
                {publishedAt && <span className="text-sm text-surface-400">{publishedAt}</span>}
              </span>
              {isInstalled && (
                <span className="shrink-0 rounded-full bg-mint px-3 py-1 text-[13px] font-bold text-ink">
                  {text.installedVersion}
                </span>
              )}
            </button>

            {isExpanded && (
              <div className="flex flex-col gap-4 px-5 pb-5 pl-[60px] pt-1">
                <ReleaseBlocks release={release} />
                <a href={release.url} target="_blank" rel="noreferrer" className={ACTION.link}>
                  <ExternalLink size={14} aria-hidden="true" />
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
    <div className="flex flex-col gap-8">
      <SettingsGroup title={text.supportTitle}>
        <div className="flex flex-col gap-4 rounded-card bg-raised px-5 py-5">
          <p className="max-w-[68ch] text-base text-surface-300">{text.supportText(APP_NAME)}</p>
          <div className="flex flex-wrap gap-3">
            <a href={GITHUB_REPO_URL} target="_blank" rel="noreferrer" className={ACTION.secondary}>
              <Star size={18} className="text-sun" aria-hidden="true" />
              {text.star}
            </a>
            <a href={GITHUB_NEW_ISSUE_URL} target="_blank" rel="noreferrer" className={ACTION.secondary}>
              <Bug size={18} aria-hidden="true" />
              {text.reportIssue}
            </a>
          </div>
        </div>
      </SettingsGroup>

      <SettingsGroup
        title={text.releaseNotes}
        aside={
          <a href={GITHUB_RELEASES_URL} target="_blank" rel="noreferrer" className={ACTION.link}>
            <ExternalLink size={14} aria-hidden="true" />
            {text.allReleases}
          </a>
        }
      >
        <ReleaseNotes />
      </SettingsGroup>
    </div>
  )
}
