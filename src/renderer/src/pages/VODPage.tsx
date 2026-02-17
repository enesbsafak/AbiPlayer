import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/store'
import { CategoryList } from '@/components/channels/CategoryList'
import { ChannelSearch } from '@/components/channels/ChannelSearch'
import { VODGrid } from '@/components/vod/VODGrid'
import { VODDetail } from '@/components/vod/VODDetail'
import { xtreamApi } from '@/services/xtream-api'
import { Spinner } from '@/components/ui/Spinner'
import type { Channel } from '@/types/playlist'

export default function VODPage() {
  const navigate = useNavigate()
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedVOD, setSelectedVOD] = useState<Channel | null>(null)
  const loadedCatsRef = useRef(new Set<string>())
  const {
    channels, activeSourceId, sources, selectedCategoryId, isLoadingPlaylist,
    channelFilter,
    setChannelFilter, playChannel, setMiniPlayer,
    addChannels, addCategories, setPlaylistLoading, getXtreamCredentials,
    categories
  } = useStore()

  useEffect(() => {
    setChannelFilter('vod')
  }, [setChannelFilter])

  // Load categories first
  useEffect(() => {
    if (!activeSourceId) return
    const source = sources.find((s) => s.id === activeSourceId)
    if (!source || source.type !== 'xtream') return
    if (categories.some((c) => c.type === 'vod' && c.sourceId === activeSourceId)) return

    const creds = getXtreamCredentials(activeSourceId)
    if (!creds) return

    const load = async () => {
      try {
        const cats = await xtreamApi.getVodCategories(creds)
        addCategories(xtreamApi.categoriesToApp(cats, activeSourceId, 'vod'))
      } catch (err) {
        console.error('Failed to load VOD categories:', err)
      }
    }
    load()
  }, [activeSourceId, sources, categories, getXtreamCredentials, addCategories])

  // Load streams for selected category
  useEffect(() => {
    if (!activeSourceId) return
    const source = sources.find((s) => s.id === activeSourceId)
    if (!source || source.type !== 'xtream') return

    const creds = getXtreamCredentials(activeSourceId)
    if (!creds) return

    // Only use category if it belongs to the VOD type
    const vodPrefix = `${activeSourceId}_vod_`
    const rawCatId = selectedCategoryId?.startsWith(vodPrefix)
      ? selectedCategoryId.replace(vodPrefix, '')
      : null

    const cacheKey = rawCatId || '__all__'
    if (loadedCatsRef.current.has(cacheKey)) return

    const load = async () => {
      setPlaylistLoading(true)
      try {
        if (rawCatId) {
          const streams = await xtreamApi.getVodStreams(creds, rawCatId)
          addChannels(xtreamApi.vodStreamsToChannels(streams, creds, activeSourceId))
        } else {
          if (channels.some((c) => c.type === 'vod' && c.sourceId === activeSourceId)) {
            loadedCatsRef.current.add(cacheKey)
            setPlaylistLoading(false)
            return
          }
          const streams = await xtreamApi.getVodStreams(creds)
          addChannels(xtreamApi.vodStreamsToChannels(streams.slice(0, 500), creds, activeSourceId))
        }
        loadedCatsRef.current.add(cacheKey)
      } catch (err) {
        console.error('Failed to load VOD:', err)
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

  const handleVODClick = useCallback((item: Channel) => {
    setSelectedVOD(item)
  }, [])

  const handlePlay = useCallback((item: Channel) => {
    playChannel(item)
    setMiniPlayer(false)
    navigate('/player')
  }, [playChannel, setMiniPlayer, navigate])

  if (selectedVOD) {
    return (
      <div className="p-6">
        <VODDetail
          item={selectedVOD}
          onBack={() => setSelectedVOD(null)}
          onPlay={handlePlay}
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
          <VODGrid items={filtered} onPlay={handleVODClick} />
        )}
      </div>
    </div>
  )
}
