import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { APP_NAME, APP_VERSION_LABEL } from '@/constants/app-info'
import type { SyncProgress } from '@/store/playlist-slice'
import { strings } from '@/strings'

const text = strings.catalog.home

const TYPE_COUNT = 3

interface HomeHeroProps {
  channelCount: number
  syncProgress?: SyncProgress
}

export function HomeHero({ channelCount, syncProgress }: HomeHeroProps) {
  const navigate = useNavigate()
  const isSyncing = syncProgress?.active === true

  return (
    <section className="relative overflow-hidden rounded-lg border border-surface-800 bg-surface-900 p-6">
      <div className="pointer-events-none absolute -right-14 -top-16 size-44 rounded-full bg-accent/25 blur-3xl" />
      <div className="pointer-events-none absolute -left-8 top-8 size-32 rounded-full bg-signal/20 blur-3xl" />
      <div className="relative flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-surface-500">{text.hubLabel}</p>
          <h1 className="mt-0.5 text-xl font-semibold text-white">{APP_NAME}</h1>
          <p className="mt-1 text-xs text-surface-500">{APP_VERSION_LABEL}</p>
          <p className="mt-1 text-sm text-surface-300">
            {text.readyCount(channelCount)}
          </p>
          {isSyncing && syncProgress && (
            <div className="mt-2 flex items-center gap-3">
              <div className="h-1.5 w-32 overflow-hidden rounded-full bg-surface-800">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-700"
                  style={{ width: `${Math.round((syncProgress.completedTypes / TYPE_COUNT) * 100)}%` }}
                />
              </div>
              <span className="text-xs text-surface-500">
                {syncProgress.currentType
                  ? text.syncLoading(
                      syncProgress.completedTypes,
                      TYPE_COUNT,
                      strings.catalog.types[syncProgress.currentType].section
                    )
                  : text.syncDone(syncProgress.completedTypes, TYPE_COUNT)}
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => void navigate('/search')}>
            {strings.common.search}
          </Button>
          <Button size="sm" onClick={() => void navigate('/settings')}>
            <Plus size={16} /> {strings.common.addSource}
          </Button>
        </div>
      </div>
    </section>
  )
}
