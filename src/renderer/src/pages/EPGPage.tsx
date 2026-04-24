import { useCallback, useMemo, useState } from 'react'
import { RefreshCw, Search, X } from 'lucide-react'
import { useStore } from '@/store'
import { fetchAndParseEPG } from '@/services/epg-service'
import { findCurrentProgram, getUpcomingPrograms, normalizeEpgChannelKey } from '@/services/epg-service'
import { normalizeSearchText } from '@/services/text-normalize'
import { xtreamApi } from '@/services/xtream-api'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import type { Channel } from '@/types/playlist'
import type { EPGProgram } from '@/types/epg'

interface ChannelEPG {
  channel: Channel
  current: EPGProgram | null
  upcoming: EPGProgram[]
  progress: number
}

export default function EPGPage() {
  const epgData = useStore((s) => s.epgData)
  const epgSourceId = useStore((s) => s.epgSourceId)
  const epgLoading = useStore((s) => s.epgLoading)
  const epgError = useStore((s) => s.epgError)
  const channels = useStore((s) => s.channels)
  const categories = useStore((s) => s.categories)
  const activeSourceId = useStore((s) => s.activeSourceId)
  const sources = useStore((s) => s.sources)
  const getXtreamCredentials = useStore((s) => s.getXtreamCredentials)
  const setEpgData = useStore((s) => s.setEpgData)
  const setEpgLoading = useStore((s) => s.setEpgLoading)
  const setEpgError = useStore((s) => s.setEpgError)

  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)
  const sourceEpgData = activeSourceId && epgSourceId === activeSourceId ? epgData : null

  const refetchEPG = useCallback(async () => {
    if (!activeSourceId) return
    const source = sources.find((s) => s.id === activeSourceId)
    if (!source || source.type !== 'xtream') return
    const creds = getXtreamCredentials(source.id)
    if (!creds) return

    setEpgLoading(true)
    setEpgError(null)
    try {
      const data = await fetchAndParseEPG(xtreamApi.buildEpgUrl(creds))
      setEpgData(source.id, data)
    } catch (err) {
      setEpgError(err instanceof Error ? err.message : 'EPG verisi alınamadı')
    } finally {
      setEpgLoading(false)
    }
  }, [activeSourceId, sources, getXtreamCredentials, setEpgData, setEpgError, setEpgLoading])

  // Live categories for filter — skip separator/decorative entries
  const liveCategories = useMemo(
    () => categories.filter((c) => {
      if (c.type !== 'live') return false
      if (activeSourceId && c.sourceId !== activeSourceId) return false
      // Skip separator categories (e.g. "---", "***", "===", "~~~")
      const cleaned = c.name.replace(/[-=*~_.#|/\\► ]/g, '').trim()
      if (cleaned.length === 0) return false
      return true
    }),
    [categories, activeSourceId]
  )

  // Build channel EPG list — only channels that have EPG data
  const channelEpgList = useMemo<ChannelEPG[]>(() => {
    if (!sourceEpgData) return []
    const now = Date.now()

    return channels
      .filter((c) => {
        if (c.type !== 'live' || !c.epgChannelId) return false
        if (activeSourceId && c.sourceId !== activeSourceId) return false
        if (selectedCategoryId && c.categoryId !== selectedCategoryId) return false
        // Only include channels that have program data
        const key = normalizeEpgChannelKey(c.epgChannelId)
        const programs = key ? sourceEpgData.programs[key] : undefined
        if (!programs || programs.length === 0) return false
        if (searchQuery) {
          const q = normalizeSearchText(searchQuery)
          if (!normalizeSearchText(c.name).includes(q)) return false
        }
        return true
      })
      .map((c) => {
        const key = normalizeEpgChannelKey(c.epgChannelId)
        const programs = (key ? sourceEpgData.programs[key] : undefined) || []
        const current = findCurrentProgram(programs, now)
        const upcoming = getUpcomingPrograms(programs, 3, now).filter((p) => p !== current)
        const progress = current
          ? Math.min(100, ((now - current.start) / (current.end - current.start)) * 100)
          : 0
        return { channel: c, current, upcoming, progress }
      })
  }, [channels, sourceEpgData, activeSourceId, selectedCategoryId, searchQuery])

  const formatTime = (ts: number) => {
    const d = new Date(ts)
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  }

  return (
    <div className="flex h-full gap-3 p-3">
      {/* Sidebar: categories */}
      <div className="w-56 shrink-0 flex flex-col overflow-hidden rounded-lg border border-surface-800 bg-surface-900">
        <div className="px-3 pt-3 pb-2">
          <p className="text-xs font-medium text-surface-500">Kategoriler</p>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-2 flex flex-col gap-0.5">
          <button
            onClick={() => setSelectedCategoryId(null)}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-left text-sm transition-colors ${
              !selectedCategoryId ? 'bg-surface-800 text-surface-50 font-medium' : 'text-surface-400 hover:bg-surface-800/50'
            }`}
          >
            Tüm Kanallar
          </button>
          {liveCategories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategoryId(cat.id)}
              className={`shrink-0 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors truncate ${
                selectedCategoryId === cat.id ? 'bg-surface-800 text-surface-50 font-medium' : 'text-surface-400 hover:bg-surface-800/50'
              }`}
              title={cat.name}
            >
              {cat.name}
            </button>
          ))}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden rounded-lg border border-surface-800 bg-surface-900">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-surface-800 px-4 py-3">
          <h1 className="text-lg font-semibold shrink-0">Yayın Akışı</h1>
          <div className="flex-1" />

          {/* Search */}
          <div className="relative w-56">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-surface-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Kanal ara..."
              className="w-full rounded-lg border border-surface-700 bg-surface-800 py-1.5 pl-8 pr-8 text-sm text-surface-50 placeholder:text-surface-500 focus:border-surface-600 focus:outline-none"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-surface-500 hover:text-surface-300">
                <X size={14} />
              </button>
            )}
          </div>

          <span className="text-xs text-surface-500 shrink-0">{channelEpgList.length} kanal</span>

          <Button variant="secondary" size="sm" onClick={refetchEPG} disabled={epgLoading}>
            {epgLoading ? <Spinner size={14} /> : <RefreshCw size={14} />}
            Yenile
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {epgLoading && !sourceEpgData && (
            <div className="flex flex-col items-center justify-center py-20 text-surface-500">
              <Spinner size={24} />
              <p className="text-sm mt-3">EPG verisi yükleniyor...</p>
            </div>
          )}

          {epgError && !sourceEpgData && (
            <div className="flex flex-col items-center justify-center py-20">
              <p className="text-sm text-red-400">{epgError}</p>
              <p className="text-xs text-surface-500 mt-1">Yenile butonuyla tekrar deneyebilirsiniz</p>
            </div>
          )}

          {sourceEpgData && channelEpgList.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-surface-500">
              <p className="text-sm">
                {searchQuery ? 'Aramayla eşleşen kanal bulunamadı' : 'Bu kategoride EPG verisi olan kanal yok'}
              </p>
            </div>
          )}

          {channelEpgList.map(({ channel, current, upcoming, progress }) => (
            <div key={channel.id} className="flex border-b border-surface-800 hover:bg-surface-800/30 transition-colors">
              {/* Channel info */}
              <div className="w-48 shrink-0 flex items-center gap-3 px-4 py-3 border-r border-surface-800">
                {channel.logo ? (
                  <img src={channel.logo} alt="" className="h-8 w-8 shrink-0 rounded object-contain bg-surface-800" />
                ) : (
                  <div className="h-8 w-8 shrink-0 rounded bg-surface-800" />
                )}
                <span className="text-sm font-medium truncate">{channel.name}</span>
              </div>

              {/* Now playing */}
              <div className="flex-1 min-w-0 flex items-stretch">
                {current ? (
                  <div className="flex-1 min-w-0 px-4 py-3 border-r border-surface-800/50">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-caption font-medium text-accent">Şimdi</span>
                      <span className="text-xs text-surface-500">{formatTime(current.start)} - {formatTime(current.end)}</span>
                    </div>
                    <p className="text-sm font-medium truncate">{current.title}</p>
                    {current.description && (
                      <p className="text-xs text-surface-500 truncate mt-0.5">{current.description}</p>
                    )}
                    <div className="mt-2 h-1 w-full rounded-full bg-surface-700">
                      <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 min-w-0 px-4 py-3 border-r border-surface-800/50 flex items-center">
                    <span className="text-xs text-surface-600">Program bilgisi yok</span>
                  </div>
                )}

                {/* Upcoming */}
                <div className="w-72 shrink-0 px-3 py-3 flex flex-col justify-center gap-1">
                  {upcoming.length > 0 ? (
                    upcoming.slice(0, 2).map((prog, i) => (
                      <div key={i} className="flex items-center gap-2 min-w-0">
                        <span className="shrink-0 text-caption text-surface-500 w-10">{formatTime(prog.start)}</span>
                        <p className="text-xs text-surface-400 truncate">{prog.title}</p>
                      </div>
                    ))
                  ) : (
                    <span className="text-xs text-surface-600">Sonraki program yok</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
