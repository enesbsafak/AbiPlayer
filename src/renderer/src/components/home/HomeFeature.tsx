import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { LazyImage } from '@/components/ui/LazyImage'
import { CloseIcon, LiveIcon, PlayIcon } from '@/components/ui/icons'
import type { CatalogItem } from '@/catalog/types'
import type { ContinueWatchingItem } from '@/services/watch-progress'
import { strings } from '@/strings'
import { describeContinue } from './home-catalog'
import { FEATURE_BADGE, FEATURE_TILE, FEATURE_TITLE } from './home-ui'
import { SPATIAL_ATTRIBUTE } from './spatial-focus'

const text = strings.catalog.home
const spatial = { [SPATIAL_ATTRIBUTE]: '' }

/** The tile's actions: the screen's primary and secondary pills, a size down so both sit on one line beside the poster. */
const TILE_PRIMARY =
  'flex h-[52px] items-center gap-2.5 rounded-full bg-white pl-6 pr-7 text-lg font-bold text-ink transition-colors hover:bg-surface-300'
const TILE_SECONDARY =
  'flex h-[52px] items-center rounded-full border-2 border-white/50 bg-transparent px-5 text-base font-medium text-white transition-colors hover:border-white'

/*
 * What the large home tile shows once the source has content: where the
 * viewer left off, else the newest film, else a way into live TV.
 *
 * The lists carry portrait posters only (a landscape still would cost a
 * request per item), so a poster is never cropped into a banner. It is shown
 * whole, as a card, and also fills the tile behind everything, blurred and
 * darkened, so the tile takes a soft colour from the film. This is the one
 * place the design's "no blur, no gradient" rule gives way, on purpose.
 */

/**
 * The ink layer over the blurred artwork. At 72 % even a white poster ends
 * up near #58565F under it, where white text keeps about 7:1 and the 80 %
 * white meta line well over 4.5:1; a dark poster only gets darker.
 */
const SCRIM = 'bg-ink/[0.72]'

/** The artwork, enlarged past the tile's edges and blurred: an ambient colour, not a picture. */
function Backdrop({ src }: { src: string }) {
  return (
    <div aria-hidden="true" className="absolute inset-0">
      <div className="absolute inset-[-12%] scale-110 blur-[48px] saturate-150">
        <LazyImage src={src} alt="" eager className="h-full w-full" fallbackClassName="hidden" />
      </div>
      <div className={`absolute inset-0 ${SCRIM}`} />
    </div>
  )
}

/**
 * The poster, whole: a rounded card taking the full height under the label
 * line, beside the text. Gives way in a short window, where the text needs
 * the width.
 */
function PosterCard({ src }: { src: string }) {
  return (
    <div className="aspect-[2/3] h-full max-w-[45%] shrink-0 overflow-hidden rounded-card short:hidden">
      <LazyImage src={src} alt="" eager fit="contain" className="h-full w-full" fallbackClassName="h-full w-full bg-raised" />
    </div>
  )
}

interface FeatureProps {
  labelId: string
  badge: string
  art?: string
  /** The top line's right end (the remove button). */
  corner?: ReactNode
  /** Decoration in the poster's place when there is no artwork. */
  emblem?: ReactNode
  children: ReactNode
}

/**
 * The one composition every content state of the tile shares, as designed:
 * the label in the top-left corner (the remove button on the same line at the
 * right), and under that line the poster at full height with the text beside
 * it, centred against the poster as one group. Equal padding on every side.
 */
function Feature({ labelId, badge, art, corner, emblem, children }: FeatureProps) {
  return (
    <section aria-labelledby={labelId} className={`${FEATURE_TILE} flex flex-col gap-4 p-6 short:gap-3 short:p-5`}>
      {art && <Backdrop src={art} />}
      <div className="relative flex shrink-0 items-center justify-between gap-3">
        <p id={labelId} className={FEATURE_BADGE}>
          {badge}
        </p>
        {corner}
      </div>
      <div className="relative flex min-h-0 flex-1 items-center gap-6">
        {art ? <PosterCard src={art} /> : emblem}
        <div className="flex min-w-0 flex-1 flex-col gap-2.5 short:gap-1.5">{children}</div>
      </div>
    </section>
  )
}

interface ContinueTileProps {
  item: ContinueWatchingItem
  onResume: (item: ContinueWatchingItem) => void
  onRestart: (item: ContinueWatchingItem) => void
  onRemove: (key: string) => void
}

export function ContinueTile({ item, onResume, onRestart, onRemove }: ContinueTileProps) {
  const { entry, channel } = item
  const { meta, percent, remaining } = describeContinue(item)
  const name = channel.name

  return (
    <Feature
      labelId="home-continue"
      badge={text.continueWatching}
      art={channel.coverUrl || channel.logo}
      corner={
        <button
          type="button"
          onClick={() => onRemove(entry.key)}
          aria-label={text.removeFromList(name)}
          title={text.removeFromListTitle}
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-ink/60 text-white transition-colors hover:bg-ink"
        >
          <CloseIcon size={16} />
        </button>
      }
    >
      <h2 className={FEATURE_TITLE} title={name}>
        {name}
      </h2>
      <p className="truncate text-base text-white/80">{meta}</p>
      <div className="mt-1 flex items-center gap-4">
        <div
          role="img"
          aria-label={text.watchedShare(percent)}
          className="h-3 w-full max-w-[280px] overflow-hidden rounded-md bg-white/25"
        >
          <div className="h-full rounded-md bg-sun" style={{ width: `${percent}%` }} />
        </div>
        <span className="whitespace-nowrap text-base font-bold">{remaining}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-3 short:mt-1">
        <button
          type="button"
          {...spatial}
          onClick={() => onResume(item)}
          aria-label={text.resume(name)}
          className={TILE_PRIMARY}
        >
          <PlayIcon size={22} />
          {text.resumeAction}
        </button>
        <button
          type="button"
          {...spatial}
          onClick={() => onRestart(item)}
          aria-label={text.restart(name)}
          className={TILE_SECONDARY}
        >
          {text.restartAction}
        </button>
      </div>
    </Feature>
  )
}

interface NewestFilmTileProps {
  film: CatalogItem
  /** The list carries dates, so this is the newest film rather than the first one listed. */
  dated: boolean
  onPlay: (film: CatalogItem) => void
}

export function NewestFilmTile({ film, dated, onPlay }: NewestFilmTileProps) {
  const meta = [text.kindFilm, film.year].filter(Boolean).join(' · ')
  return (
    <Feature labelId="home-newest" badge={dated ? text.newestBadge : text.firstInListBadge} art={film.coverUrl || film.logo}>
      <h2 className={FEATURE_TITLE} title={film.name}>
        {film.name}
      </h2>
      <p className="truncate text-base text-white/80">{meta}</p>
      <div className="mt-2 flex flex-wrap gap-3 short:mt-1">
        <button type="button" {...spatial} onClick={() => onPlay(film)} className={TILE_PRIMARY}>
          <PlayIcon size={22} />
          {text.playAction}
        </button>
        <Link to="/vod" {...spatial} className={TILE_SECONDARY}>
          {text.browseFilms}
        </Link>
      </div>
    </Feature>
  )
}

/** Content, but nothing unfinished and no film to suggest (a live-only list): the flat raised tile. */
export function IdleTile() {
  return (
    <Feature
      labelId="home-idle"
      badge={text.idleBadge}
      emblem={
        <LiveIcon size={132} weight={1.8} className="shrink-0 text-coral short:hidden" />
      }
    >
      <h2 className={FEATURE_TITLE}>{text.idleTitle}</h2>
      <p className="max-w-md text-lg text-surface-400">{text.idleHint}</p>
      <Link to="/live" {...spatial} className={`${TILE_PRIMARY} mt-2 self-start`}>
        <PlayIcon size={22} />
        {text.openLive}
      </Link>
    </Feature>
  )
}
