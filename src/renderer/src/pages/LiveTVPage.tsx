import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/store'
import { CategoryList } from '@/components/channels/CategoryList'
import { ChannelGrid } from '@/components/channels/ChannelGrid'
import { ChannelSearch } from '@/components/channels/ChannelSearch'
import { xtreamApi } from '@/services/xtream-api'
import { Spinner } from '@/components/ui/Spinner'
import type { Channel } from '@/types/playlist'

export default function LiveTVPage() {
  const navigate = useNavigate()
  const [searchQuery, setSearchQuery] = useState('')
  const loadedCatsRef = useRef(new Set<string>())
  const {
    channels, activeSourceId, sources, selectedCategoryId, isLoadingPlaylist,
    channelFilter,
    setChannelFilter, playChannel, setMiniPlayer,
    addChannels, addCategories, setPlaylistLoading, getXtreamCredentials,
    categories
  } = useStore()

  useEffect(() => {
    setChannelFilter('live')
  }, [setChannelFilter])

  // Load categories first (lightweight)
  useEffect(() => {
    if (!activeSourceId) return
    const source = sources.find((s) => s.id === activeSourceId)
    if (!source || source.type !== 'xtream') return
    if (categories.some((c) => c.type === 'live' && c.sourceId === activeSourceId)) return

    const creds = getXtreamCredentials(activeSourceId)
    if (!creds) return

    const load = async () => {
      try {
        const cats = await xtreamApi.getLiveCategories(creds)
        addCategories(xtreamApi.categoriesToApp(cats, activeSourceId, 'live'))
      } catch (err) {
        console.error('Failed to load live categories:', err)
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

    // Only use category if it belongs to the live type
    const livePrefix = `${activeSourceId}_live_`
    const rawCatId = selectedCategoryId?.startsWith(livePrefix)
      ? selectedCategoryId.replace(livePrefix, '')
      : null

    const cacheKey = rawCatId || '__all__'
    if (loadedCatsRef.current.has(cacheKey)) return

    const load = async () => {
      setPlaylistLoading(true)
      try {
        if (rawCatId) {
          // Load specific category
          const streams = await xtreamApi.getLiveStreams(creds, rawCatId)
          addChannels(xtreamApi.liveStreamsToChannels(streams, creds, activeSourceId))
        } else {
          // "All Channels" — load first 500
          if (channels.some((c) => c.type === 'live' && c.sourceId === activeSourceId)) {
            // Already have some channels, skip
            loadedCatsRef.current.add(cacheKey)
            setPlaylistLoading(false)
            return
          }
          const streams = await xtreamApi.getLiveStreams(creds)
          addChannels(xtreamApi.liveStreamsToChannels(streams.slice(0, 500), creds, activeSourceId))
        }
        loadedCatsRef.current.add(cacheKey)
      } catch (err) {
        console.error('Failed to load live streams:', err)
      } finally {
        setPlaylistLoading(false)
      }
    }
    load()
  }, [activeSourceId, selectedCategoryId, sources, getXtreamCredentials, addChannels, setPlaylistLoading]) // channels intentionally excluded to avoid loop

  // Filter channels reactively from state
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

  const handlePlay = useCallback((channel: Channel) => {
    playChannel(channel)
    setMiniPlayer(false)
    navigate('/player')
  }, [playChannel, setMiniPlayer, navigate])

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
          <ChannelGrid channels={filtered} onPlay={handlePlay} />
        )}
      </div>
    </div>
  )
}
