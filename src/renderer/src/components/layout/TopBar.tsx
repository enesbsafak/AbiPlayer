import { useState, type FormEvent } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { ArrowLeftIcon, SearchIcon, SlidersIcon, StarIcon } from '@/components/ui/icons'
import { formatClockTime, formatWeekday, useMinuteClock } from '@/hooks/useMinuteClock'
import { APP_NAME } from '@/constants/app-info'
import { strings } from '@/strings'
import { SECTIONS, TONE, type ScreenInfo } from './sections'
import { UpdateReadyPill } from './UpdateBadge'
import { WindowControls } from './WindowControls'

const nav = strings.shell.nav
const header = strings.shell.header

/*
 * The two top bars of the "Canlı renk" shell (docs/tasarim): the home bar
 * (brand, search, clock, Favoriler and Ayarlar, window buttons) and the bar of
 * every inner screen (back to home, the screen's tile and title, the section
 * switcher, clock, window buttons). No sidebar.
 *
 * Each bar is the window's drag region: the frameless window moves by any of
 * its empty space, and a double click there maximizes it (answered in main,
 * src/main/ipc/window.ts). Every control in it opts out with `no-drag`.
 *
 * The window can be as small as 900 × 600. Below 1280 px the pills drop their
 * words (they keep them as their accessible names) and the weekday goes, and
 * the inner bar's section switcher moves to a row of its own.
 */

const RAISED_PILL =
  'no-drag flex h-[52px] shrink-0 items-center gap-2.5 rounded-full bg-raised font-bold text-white transition-colors hover:bg-surface-800'

function Clock({ withWeekday }: { withWeekday: boolean }) {
  const now = useMinuteClock()
  const iso = new Date(now).toISOString()
  return (
    <div className="flex shrink-0 items-baseline gap-2 whitespace-nowrap max-lg:hidden">
      <time dateTime={iso} className="text-[26px] font-bold leading-none tracking-[-0.01em] tabular-nums">
        {formatClockTime(now)}
      </time>
      {withWeekday && <span className="text-[15px] text-surface-500 max-xl:hidden">{formatWeekday(now)}</span>}
    </div>
  )
}

/** The four coloured squares and the name. */
function Brand() {
  return (
    <div className="mr-2 flex shrink-0 items-center gap-3">
      <div aria-hidden="true" className="grid size-8 grid-cols-2 gap-1">
        <span className="rounded-[6px] bg-coral" />
        <span className="rounded-[6px] bg-sun" />
        <span className="rounded-[6px] bg-mint" />
        <span className="rounded-[6px] bg-sky" />
      </div>
      <span className="font-title whitespace-nowrap text-[28px] lg:text-[36px]">{APP_NAME}</span>
    </div>
  )
}

/**
 * Search from the home bar: Enter opens the search screen with what was typed
 * (or empty, to start typing there). Searching as you type stays the search
 * screen's job, where the results have room.
 */
function HomeSearch() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const value = query.trim()
    void navigate('/search', value ? { state: { restoreSearchQuery: value } } : undefined)
  }

  return (
    <form
      role="search"
      onSubmit={submit}
      className="no-drag flex h-[52px] min-w-[180px] flex-[0_1_340px] items-center gap-3 rounded-full bg-raised px-5 text-white focus-within:outline focus-within:outline-[3px] focus-within:outline-offset-[3px] focus-within:outline-sun"
    >
      <SearchIcon size={22} />
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        aria-label={header.searchLabel}
        placeholder={header.searchPlaceholder}
        className="h-full min-w-0 flex-1 bg-transparent text-base text-white outline-none placeholder:text-surface-500 focus-visible:outline-none"
      />
    </form>
  )
}

export function HomeTopBar() {
  return (
    // The bar spans the window and the window buttons sit in its top-right
    // corner; everything else lines up with home's column (full width, centred
    // past 2400 px: HomePage), starting where the column starts.
    <header className="drag-region flex shrink-0 items-center gap-4 px-6 pt-5 short:pt-4">
      <div className="ml-[max(0px,calc((100%-2400px)/2))] flex min-w-0 max-w-[2400px] flex-1 items-center gap-4">
        <Brand />
        <HomeSearch />
        <div className="flex-1" />
        <Clock withWeekday />
        <UpdateReadyPill />
        <Link to="/favorites" className={`${RAISED_PILL} px-[15px] xl:pl-[18px] xl:pr-[22px]`}>
          <StarIcon size={22} className="text-sun" />
          <span className="max-xl:sr-only">{nav.favorites}</span>
        </Link>
        <Link to="/settings" className={`${RAISED_PILL} px-[15px] xl:pl-[18px] xl:pr-[22px]`}>
          <SlidersIcon size={22} className="text-sky" />
          <span className="max-xl:sr-only">{nav.settings}</span>
        </Link>
      </div>
      <div className="ml-auto">
        <WindowControls />
      </div>
    </header>
  )
}

/** The four sections; the current one is filled with its colour, the rest carry it as a dot. */
function SectionSwitcher() {
  return (
    <nav aria-label={nav.sections} className="no-drag flex flex-wrap gap-2 max-xl:order-last max-xl:w-full">
      {SECTIONS.map((section) => (
        <NavLink
          key={section.path}
          to={section.path}
          className={({ isActive }) =>
            `flex h-11 items-center gap-2 whitespace-nowrap rounded-full ${
              isActive
                ? `${TONE[section.tone].fill} px-[18px] font-bold text-ink`
                : 'bg-raised pl-4 pr-[18px] font-medium text-white hover:bg-surface-800'
            }`
          }
        >
          {({ isActive }) => (
            <>
              {!isActive && <span aria-hidden="true" className={`size-2.5 rounded-full ${TONE[section.tone].fill}`} />}
              {section.title}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}

export function InnerTopBar({ screen }: { screen: ScreenInfo | null }) {
  const Icon = screen?.icon
  return (
    <header className="drag-region flex min-h-[52px] shrink-0 flex-wrap items-center gap-3 px-6 pt-5">
      <Link
        to="/"
        className={`${RAISED_PILL} pl-[18px] pr-[22px] xl:max-2xl:w-[52px] xl:max-2xl:justify-center xl:max-2xl:px-0`}
      >
        <ArrowLeftIcon size={22} />
        <span className="xl:max-2xl:sr-only">{nav.home}</span>
      </Link>
      {screen && Icon && (
        <div className="ml-1 flex min-w-0 items-center gap-3.5">
          <div
            aria-hidden="true"
            className={`flex size-[52px] shrink-0 items-center justify-center rounded-[18px] ${TONE[screen.tone].fill} ${
              screen.tone === 'neutral' ? 'text-white' : 'text-ink'
            }`}
          >
            <Icon size={28} />
          </div>
          <h1 className="font-title truncate text-[30px] leading-[1.15] lg:text-[36px]">{screen.title}</h1>
        </div>
      )}
      <div className="flex-1" />
      <SectionSwitcher />
      {screen?.path !== '/search' && (
        <Link
          to="/search"
          aria-label={header.openSearch}
          title={`${nav.search} (${header.searchShortcut})`}
          className="no-drag flex size-11 shrink-0 items-center justify-center rounded-full bg-raised text-white transition-colors hover:bg-surface-800"
        >
          <SearchIcon size={20} />
        </Link>
      )}
      <Clock withWeekday={false} />
      <UpdateReadyPill />
      <WindowControls />
    </header>
  )
}
