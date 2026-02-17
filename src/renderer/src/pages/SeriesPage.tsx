import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/store'
import { CategoryList } from '@/components/channels/CategoryList'
import { ChannelSearch } from '@/components/channels/ChannelSearch'
import { VODGrid } from '@/components/vod/VODGrid'
import { SeriesDetail } from '@/components/series/SeriesDetail'
import { xtreamApi } from '@/services/xtream-api'
import { Spinner } from '@/components/ui/Spinner'
import type { Channel } from '@/types/playlist'

export default function SeriesPage() {
  const navigate = useNavigate()
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedSeries, setSelectedSeries] = useState<{ seriesId: number; sourceId: string } | null>(null)
  const loadedCatsRef = useRef(new Set<string>())
  const {
    channels, activeSourceId, sources, selectedCategoryId, isLoadingPlaylist,
    channelFilter,
    setChannelFilter, playChannel, setMiniPlayer,
    addChannels, addCategories, setPlaylistLoading, getXtreamCredentials,
    categories
  } = useStore()

  useEffect(() => {
    setChannelFilter('series')
  }, [setChannelFilter])

  // Load categories first
  useEffect(() => {
    if (!activeSourceId) return
    const source = sources.find((s) => s.id === activeSourceId)
    if (!source || source.type !== 'xtream') return
    if (categories.some((c) => c.type === 'series' && c.sourceId === activeSourceId)) return

    const creds = getXtreamCredentials(activeSourceId)
    if (!creds) return

    const load = async () => {
      try {
        const cats = await xtreamApi.getSeriesCategories(creds)
        addCategories(xtreamApi.categoriesToApp(cats, activeSourceId, 'series'))
      } catch (err) {
        console.error('Failed to load series categories:', err)
      }
    }
    load()
  }, [activeSourceId, sources, categories, getXtreamCredentials, addCategories])

  // Load series for selected category
  useEffect(() => {
    if (!activeSourceId) return
    const source = sources.find((s) => s.id === activeSourceId)
    if (!source || source.type !== 'xtream') return

    const creds = getXtreamCredentials(activeSourceId)
    if (!creds) return

    // Only use category if it belongs to the series type
    const seriesPrefix = `${activeSourceId}_series_`
    const rawCatId = selectedCategoryId?.startsWith(seriesPrefix)
      ? selectedCategoryId.replace(seriesPrefix, '')
      : null

    const cacheKey = rawCatId || '__all__'
    if (loadedCatsRef.current.has(cacheKey)) return

    const load = async () => {
      setPlaylistLoading(true)
      try {
        if (rawCatId) {
          const series = await xtreamApi.getSeries(creds, rawCatId)
          addChannels(xtreamApi.seriesToChannels(series, activeSourceId))
        } else {
          if (channels.some((c) => c.type === 'series' && c.sourceId === activeSourceId)) {
            loadedCatsRef.current.add(cacheKey)
            setPlaylistLoading(false)
            return
          }
          const series = await xtreamApi.getSeries(creds)
          addChannels(xtreamApi.seriesToChannels(series.slice(0, 500), activeSourceId))
        }
        loadedCatsRef.current.add(cacheKey)
      } catch (err) {
        console.error('Failed to load series:', err)
      } finally {
        setPlaylistLoading(false)
      }
    }
    load()
  }, [activeSourceId, selectedCategoryId, sources, getXtreamCredentials, addChannels, setPlaylistLoading])

  const filtered = useMemo(() => {
    let list = channels.filter((c) => c.type === channelFilter)
    if (selectedCategoryId) {
      list = list.filter((c) => c.categoryId === selectedCategoryId)
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      list = list.filter((c) => c.name.toLowerCase().includes(q))
    }
    return list
  }, [channels, channelFilter, selectedCategoryId, searchQuery])

  const handleSeriesClick = useCallback((item: Channel) => {
    if (item.seriesId) {
      setSelectedSeries({ seriesId: item.seriesId, sourceId: item.sourceId })
    }
  }, [])

  const handlePlayEpisode = useCallback((url: string, title: string) => {
    playChannel({ id: `ep_${Date.now()}`, name: title, streamUrl: url, sourceId: '', type: 'vod' })
    setMiniPlayer(false)
    navigate('/player')
  }, [playChannel, setMiniPlayer, navigate])

  if (selectedSeries) {
    return (
      <div className="p-6">
        <SeriesDetail
          seriesId={selectedSeries.seriesId}
          sourceId={selectedSeries.sourceId}
          onBack={() => setSelectedSeries(null)}
          onPlayEpisode={handlePlayEpisode}
        />
      </div>
    )
  }

  return (
    <div className="flex h-full">
      <div className="w-52 shrink-0 overflow-y-auto border-r border-surface-800 p-3">
        <CategoryList />
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mb-4">
          <ChannelSearch onSearch={setSearchQuery} />
        </div>
        {isLoadingPlaylist ? (
          <div className="flex items-center justify-center py-20"><Spinner size={32} /></div>
        ) : (
          <VODGrid items={filtered} onPlay={handleSeriesClick} />
        )}
      </div>
    </div>
  )
}
