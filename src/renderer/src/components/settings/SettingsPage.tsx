import { useSearchParams } from 'react-router-dom'
import { Captions, Database, Download, Heart, LayoutGrid, Play, SlidersHorizontal } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { SourcesSettings } from './SourcesSettings'
import { PlaybackSettings } from './PlaybackSettings'
import { SubtitleSettings } from './SubtitleSettings'
import { CatalogSettings } from './CatalogSettings'
import { GeneralSettings } from './GeneralSettings'
import { UpdateSettings } from './UpdateSettings'
import { SupportSettings } from './SupportSettings'
import { strings } from '@/strings'

export type SettingsTabId =
  | 'sources'
  | 'playback'
  | 'subtitles'
  | 'catalog'
  | 'general'
  | 'updates'
  | 'support'

interface SettingsTab {
  id: SettingsTabId
  label: string
  description: string
  icon: LucideIcon
}

const TAB_ICONS: Array<[SettingsTabId, LucideIcon]> = [
  ['sources', Database],
  ['playback', Play],
  ['subtitles', Captions],
  ['catalog', LayoutGrid],
  ['general', SlidersHorizontal],
  ['updates', Download],
  ['support', Heart]
]

const TABS: SettingsTab[] = TAB_ICONS.map(([id, icon]) => ({ id, icon, ...strings.settings.tabs[id] }))

/** The label a settings tab is shown with, for texts that send the user there. */
export function settingsTabLabel(id: SettingsTabId): string {
  return strings.settings.tabs[id].label
}

function renderTab(tabId: SettingsTabId) {
  switch (tabId) {
    case 'sources':
      return <SourcesSettings />
    case 'playback':
      return <PlaybackSettings />
    case 'subtitles':
      return <SubtitleSettings />
    case 'catalog':
      return <CatalogSettings />
    case 'general':
      return <GeneralSettings />
    case 'updates':
      return <UpdateSettings />
    case 'support':
      return <SupportSettings />
  }
}

function isTabId(value: string | null): value is SettingsTabId {
  return TABS.some((tab) => tab.id === value)
}

/**
 * Tabbed settings ("Canlı renk": settings wear sky).
 *
 * The tabs are a column of pills beside a centred column of content, the
 * chosen one filled with sky; in a window narrower than 1024 px they are a
 * row of pills above it. The content keeps a readable line length (at most
 * 820 px, 900 px from 1800 px up), and the pair is centred as one, so a wide
 * window leaves even margins on both sides rather than rows stretched across
 * it or a dead band on one side.
 *
 * Each tab holds one subject, so nothing needs scrolling past to be found.
 */
export function SettingsContent() {
  // The URL owns the active tab so deep links like /settings?tab=support land on
  // the right section even when this page is already mounted.
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedTab = searchParams.get('tab')
  const activeTab: SettingsTabId = isTabId(requestedTab) ? requestedTab : 'sources'
  const active = strings.settings.tabs[activeTab]

  return (
    <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-6 pb-10 lg:flex-row lg:items-start lg:gap-10 min-[1800px]:max-w-[1210px]">
      <nav
        aria-label={strings.settings.tabsLabel}
        className="flex shrink-0 flex-wrap gap-2 lg:sticky lg:top-2 lg:w-[220px] lg:flex-col min-[1800px]:w-[250px]"
      >
        {TABS.map((tab) => {
          const Icon = tab.icon
          const isActive = tab.id === activeTab
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSearchParams({ tab: tab.id }, { replace: true })}
              aria-current={isActive ? 'page' : undefined}
              className={`flex h-11 shrink-0 items-center gap-3 whitespace-nowrap rounded-full px-[18px] text-[15px] transition-colors lg:h-[52px] lg:px-5 lg:text-base ${
                isActive ? 'bg-sky font-bold text-ink' : 'bg-raised font-medium text-white hover:bg-surface-800'
              }`}
            >
              <Icon size={20} className="shrink-0 max-lg:hidden" aria-hidden="true" />
              {tab.label}
            </button>
          )
        })}
      </nav>

      <div className="flex min-w-0 max-w-[820px] flex-1 flex-col gap-8 min-[1800px]:max-w-[900px]">
        <header className="flex flex-col gap-2">
          <h2 className="font-title text-[30px] leading-[1.15] lg:text-[34px]">{active.label}</h2>
          <p className="text-base text-surface-400">{active.description}</p>
        </header>

        {renderTab(activeTab)}
      </div>
    </div>
  )
}
