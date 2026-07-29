import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { APP_NAME, APP_VERSION_LABEL } from '@/constants/app-info'
import type { SyncProgress } from '@/store/playlist-slice'

const TYPE_LABELS = {
  live: 'Canlı TV',
  vod: 'Filmler',
  series: 'Diziler'
} as const

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
          <p className="text-xs font-medium text-surface-500">Yayın Merkezi</p>
          <h1 className="mt-0.5 text-xl font-semibold text-white">{APP_NAME}</h1>
          <p className="mt-1 text-xs text-surface-500">{APP_VERSION_LABEL}</p>
          <p className="mt-1 text-sm text-surface-300">
            Canlı yayın, film ve dizilerde toplam {channelCount} içerik hazır.
          </p>
          {isSyncing && syncProgress && (
            <div className="mt-2 flex items-center gap-3">
              <div className="h-1.5 w-32 overflow-hidden rounded-full bg-surface-800">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-700"
                  style={{ width: `${Math.round((syncProgress.completedTypes / 3) * 100)}%` }}
                />
              </div>
              <span className="text-xs text-surface-500">
                {syncProgress.currentType
                  ? `${syncProgress.completedTypes}/3 — ${TYPE_LABELS[syncProgress.currentType]} yükleniyor`
                  : `${syncProgress.completedTypes}/3 tamamlandı`}
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => navigate('/search')}>
            Ara
          </Button>
          <Button size="sm" onClick={() => navigate('/settings')}>
            <Plus size={16} /> Kaynak Ekle
          </Button>
        </div>
      </div>
    </section>
  )
}
