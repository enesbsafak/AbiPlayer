import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/store'
import { CategoryList } from '@/components/channels/CategoryList'
import { ChannelSearch } from '@/components/channels/ChannelSearch'
import { VODGrid } from '@/components/vod/VODGrid'
import { SeriesDetail } from '@/components/series/SeriesDetail'
import { xtreamApi } from '@/services/xtream-api'
import { Spinner } from '@/components/ui/Spinner'
import { Button } from '@/components/ui/Button'
import type { Channel } from '@/types/playlist'
import { isPlayableChannel } from '@/services/playback'

export default function SeriesPage() {
  const navigate = useNavigate()
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedSeries, setSelectedSeries] = useState<{ seriesId: number; sourceId: string } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const loadedCatsRef = useRef(new Set<string>())

  const channels = useStore((s) => s.channels)
  const activeSourceId = useStore((s) => s.activeSourceId)
  const sources = useStore((s) => s.sources)
  const selectedCategoryId = useStore((s) => s.selectedCategoryId)
  const isLoadingPlaylist = useStore((s) => s.isLoadingPlaylist)
  const channelFilter = useStore((s) => s.channelFilter)
  const setChannelFilter = useStore((s) => s.setChannelFilter)
  const playChannel = useStore((s) => s.playChannel)
  const setMiniPlayer = useStore((s) => s.setMiniPlayer)
  const addChannels = useStore((s) => s.addChannels)
  const addCategories = useStore((s) => s.addCategories)
  const setPlaylistLoading = useStore((s) => s.setPlaylistLoading)
  const getXtreamCredentials = useStore((s) => s.getXtreamCredentials)
  const setSelectedCategory = useStore((s) => s.setSelectedCategory)
  const categories = useStore((s) => s.categories)

  useEffect(() => {
    setChannelFilter('series')
  }, [setChannelFilter])

  useEffect(() => {
    loadedCatsRef.current.clear()
    setSelectedCategory(null)
    setSelectedSeries(null)
    setLoadError(null)
  }, [activeSourceId, setSelectedCategory])

  useEffect(() => {
    if (!activeSourceId) return
    const hasChannelsForSource = channels.some(
      (channel) => channel.sourceId === activeSourceId && channel.type === 'series'
    )
    if (!hasChannelsForSource) loadedCatsRef.current.clear()
  }, [channels, activeSourceId])

  useEffect(() => {
    if (!activeSourceId) return
    const source = sources.find((s) => s.id === activeSourceId)
    if (!source || source.type !== 'xtream') return
    if (categories.some((c) => c.type === 'series' && c.sourceId === activeSourceId)) return

    const creds = getXtreamCredentials(activeSourceId)
    if (!creds) return

    let cancelled = false
    const load = async () => {
      try {
        const cats = await xtreamApi.getSeriesCategories(creds)
        if (cancelled) return
        addCategories(xtreamApi.categoriesToApp(cats, activeSourceId, 'series'))
      } catch (err) {
        if (cancelled) return
        console.error('Failed to load series categories:', err)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [activeSourceId, sources, categories, getXtreamCredentials, addCategories])

  useEffect(() => {
    if (!activeSourceId) return
    const source = sources.find((s) => s.id === activeSourceId)
    if (!source || source.type !== 'xtream') return

    const creds = getXtreamCredentials(activeSourceId)
    if (!creds) return

    const seriesPrefix = `${activeSourceId}_series_`
    const rawCatId = selectedCategoryId?.startsWith(seriesPrefix)
      ? selectedCategoryId.replace(seriesPrefix, '')
      : null

    const cacheKey = `${activeSourceId}:${rawCatId || '__all__'}`
    if (loadedCatsRef.current.has(cacheKey)) return

    let cancelled = false
    const load = async () => {
      setLoadError(null)
      setPlaylistLoading(true)

      try {
        if (rawCatId) {
          const series = await xtreamApi.getSeries(creds, rawCatId)
          if (cancelled) return
          addChannels(xtreamApi.seriesToChannels(series, activeSourceId))
        } else {
          const hasAnySeries = channels.some((c) => c.type === 'series' && c.sourceId === activeSourceId)
          if (hasAnySeries) {
            loadedCatsRef.current.add(cacheKey)
            return
          }

          const series = await xtreamApi.getSeriesPreviewStreams(creds, 500)
          if (cancelled) return
          addChannels(xtreamApi.seriesToChannels(series, activeSourceId))
        }

        loadedCatsRef.current.add(cacheKey)
      } catch (err) {
        if (cancelled) return
        console.error('Failed to load series:', err)
        setLoadError(err instanceof Error ? err.message : 'Diziler yuklenemedi')
      } finally {
        if (!cancelled) setPlaylistLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [
    activeSourceId,
    selectedCategoryId,
    sources,
    channels,
    getXtreamCredentials,
    addChannels,
    setPlaylistLoading,
    reloadToken
  ])

  const filtered = useMemo(() => {
    let list = channels.filter((c) => c.type === channelFilter)

    if (activeSourceId) {
      list = list.filter((c) => c.sourceId === activeSourceId)
    }
    if (selectedCategoryId) {
      list = list.filter((c) => c.categoryId === selectedCategoryId)
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      list = list.filter((c) => c.name.toLowerCase().includes(q))
    }

    return list
  }, [channels, activeSourceId, channelFilter, selectedCategoryId, searchQuery])

  const handleSeriesClick = useCallback((item: Channel) => {
    if (item.seriesId) {
      setSelectedSeries({ seriesId: item.seriesId, sourceId: item.sourceId })
    }
  }, [])

  const handlePlayEpisode = useCallback(
    (url: string, title: string) => {
      const episodeChannel = {
        id: `ep_${Date.now()}`,
        name: title,
        streamUrl: url,
        sourceId: '',
        type: 'vod' as const
      }
      if (!isPlayableChannel(episodeChannel)) return
      playChannel(episodeChannel)
      setMiniPlayer(false)
      navigate('/player')
    },
    [playChannel, setMiniPlayer, navigate]
  )

  if (selectedSeries) {
    return (
      <div className="h-full p-3">
        <div className="panel-glass h-full overflow-y-auto rounded-2xl p-5">
          <SeriesDetail
            seriesId={selectedSeries.seriesId}
            sourceId={selectedSeries.sourceId}
            onBack={() => setSelectedSeries(null)}
            onPlayEpisode={handlePlayEpisode}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full gap-3 p-3">
      <div className="panel-glass w-56 shrink-0 overflow-y-auto rounded-2xl p-3">
        <CategoryList />
      </div>
      <div className="panel-glass flex-1 overflow-y-auto rounded-2xl p-5">
        <div className="mb-5">
          <ChannelSearch onSearch={setSearchQuery} />
        </div>

        {loadError && (
          <div className="mb-4 flex items-center justify-between rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            <span>{loadError}</span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                loadedCatsRef.current.clear()
                setReloadToken((v) => v + 1)
              }}
            >
              Tekrar Dene
            </Button>
          </div>
        )}

        {isLoadingPlaylist ? (
          <div className="flex items-center justify-center py-20">
            <Spinner size={32} />
          </div>
        ) : (
          <VODGrid items={filtered} onPlay={handleSeriesClick} />
        )}
      </div>
    </div>
  )
}
