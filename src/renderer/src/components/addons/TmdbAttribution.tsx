import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
// Emitted as its own file (never inlined), so the shipped bytes are TMDB's.
import tmdbLogoUrl from '@/assets/tmdb/tmdb-alt-short-blue.svg?no-inline'
import { strings } from '@/strings'

const text = strings.sources.tmdbCatalog

/**
 * TMDB's credit where the built-in catalogue's data is shown: the official
 * "alt short" logo, unmodified and small (less prominent than the app's own
 * mark, as TMDB's terms ask), and one quiet line. The full notice is in
 * Ayarlar → Destek → Lisanslar.
 */
export function TmdbAttribution({ className = '', tone = 'quiet' }: { className?: string; tone?: 'quiet' | 'ink' }) {
  return (
    // A span (it also sits inside the source row's button), laid out as a line.
    <span className={`flex min-w-0 items-center gap-2 text-xs ${tone === 'ink' ? 'text-ink/75' : 'text-surface-500'} ${className}`}>
      <img src={tmdbLogoUrl} alt={text.logoAlt} width={92} height={12} className="h-2.5 w-auto shrink-0" draggable={false} />
      <span className="min-w-0 truncate">{text.attribution}</span>
    </span>
  )
}

let keyFocusRequested = false

/** Whether the key's field was asked to take the focus when it appears; asking once. */
export function takeTmdbKeyFocusRequest(): boolean {
  const requested = keyFocusRequested
  keyFocusRequested = false
  return requested
}

/** Opens Ayarlar → Genel with the TMDB key's field in focus. */
export function useOpenTmdbKeyField(): () => void {
  const navigate = useNavigate()
  return useCallback(() => {
    keyFocusRequested = true
    void navigate('/settings?tab=general')
  }, [navigate])
}

/** "Anahtarı gir": the way to the TMDB key's field, wherever the catalogue says it needs one. */
export function EnterTmdbKeyButton({ className }: { className: string }) {
  const open = useOpenTmdbKeyField()
  return (
    <button type="button" className={className} onClick={open}>
      {text.enterKey}
    </button>
  )
}
