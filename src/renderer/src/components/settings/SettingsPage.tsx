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

const TABS: SettingsTab[] = [
  { id: 'sources', label: 'Kaynaklar', description: 'Xtream ve M3U kaynaklarınızı yönetin', icon: Database },
  { id: 'playback', label: 'Oynatma', description: 'Dublaj dili, canlı yayın biçimi, donanım hızlandırma ve ses passthrough', icon: Play },
  { id: 'subtitles', label: 'Altyazı', description: 'Altyazı dili ve görünümü', icon: Captions },
  { id: 'catalog', label: 'Katalog', description: 'Hangi kategorilerin listelerde görüneceği', icon: LayoutGrid },
  { id: 'general', label: 'Genel', description: 'Saat, EPG, TMDB ve sıfırlama', icon: SlidersHorizontal },
  { id: 'updates', label: 'Güncelleme', description: 'Sürüm bilgisi ve güncelleme kontrolü', icon: Download },
  { id: 'support', label: 'Destek', description: 'Projeye katkı, geri bildirim ve sürüm notları', icon: Heart }
]

/** The label a settings tab is shown with, for texts that send the user there. */
export function settingsTabLabel(id: SettingsTabId): string {
  return TABS.find((tab) => tab.id === id)?.label ?? id
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
 * Tabbed settings shell.
 *
 * This used to be one 579-line scroll where a single "Oynatıcı" section carried
 * thirteen unrelated controls — subtitle colours next to hardware decoding next
 * to a TMDB API key. Each tab now holds one subject, so nothing needs scrolling
 * past to be found.
 */
export function SettingsContent() {
  // The URL owns the active tab so deep links like /settings?tab=support land on
  // the right section even when this page is already mounted.
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedTab = searchParams.get('tab')
  const activeTab: SettingsTabId = isTabId(requestedTab) ? requestedTab : 'sources'
  const active = TABS.find((tab) => tab.id === activeTab) ?? TABS[0]

  return (
    <div className="flex flex-col gap-5 lg:flex-row lg:gap-6">
      {/* Horizontal strip on narrow windows, sidebar from lg up. */}
      <nav
        aria-label="Ayar bölümleri"
        className="flex shrink-0 gap-1 overflow-x-auto lg:w-52 lg:flex-col lg:overflow-visible"
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
              className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                isActive
                  ? 'border border-accent/45 bg-accent/15 text-accent'
                  : 'border border-transparent text-surface-400 hover:bg-surface-900 hover:text-surface-200'
              }`}
            >
              <Icon size={16} className="shrink-0" />
              <span className="whitespace-nowrap">{tab.label}</span>
            </button>
          )
        })}
      </nav>

      <div className="min-w-0 flex-1 max-w-3xl">
        <div className="mb-4">
          <h2 className="text-lg font-semibold">{active.label}</h2>
          <p className="mt-0.5 text-sm text-surface-500">{active.description}</p>
        </div>

        {renderTab(activeTab)}
      </div>
    </div>
  )
}
