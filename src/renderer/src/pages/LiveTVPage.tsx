import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/store'
import { CategoryList } from '@/components/channels/CategoryList'
import { ChannelGrid } from '@/components/channels/ChannelGrid'
import { ChannelSearch } from '@/components/channels/ChannelSearch'
import { xtreamApi } from '@/services/xtream-api'
import { Spinner } from '@/components/ui/Spinner'
import { Button } from '@/components/ui/Button'
import type { Channel } from '@/types/playlist'
import { isPlayableChannel } from '@/services/playback'

export default function LiveTVPage() {
  const navigate = useNavigate()
  const [searchQuery, setSearchQuery] = useState('')
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
    setChannelFilter('live')
  }, [setChannelFilter])

  useEffect(() => {
    loadedCatsRef.current.clear()
    setSelectedCategory(null)
    setLoadError(null)
  }, [activeSourceId, setSelectedCategory])

  useEffect(() => {
    if (!activeSourceId) return
    const hasChannelsForSource = channels.some(
      (channel) => channel.sourceId === activeSourceId && channel.type === 'live'
    )
    if (!hasChannelsForSource) loadedCatsRef.current.clear()
  }, [channels, activeSourceId])

  // Load categories first.
  useEffect(() => {
    if (!activeSourceId) return
    const source = sources.find((s) => s.id === activeSourceId)
    if (!source || source.type !== 'xtream') return
    if (categories.some((c) => c.type === 'live' && c.sourceId === activeSourceId)) return

    const creds = getXtreamCredentials(activeSourceId)
    if (!creds) return

    let cancelled = false
    const load = async () => {
      try {
        const cats = await xtreamApi.getLiveCategories(creds)
        if (cancelled) return
        addCategories(xtreamApi.categoriesToApp(cats, activeSourceId, 'live'))
      } catch (err) {
        if (cancelled) return
        console.error('Failed to load live categories:', err)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [activeSourceId, sources, categories, getXtreamCredentials, addCategories])

  // Load streams for selected category.
  useEffect(() => {
    if (!activeSourceId) return
    const source = sources.find((s) => s.id === activeSourceId)
    if (!source || source.type !== 'xtream') return

    const creds = getXtreamCredentials(activeSourceId)
    if (!creds) return

    const livePrefix = `${activeSourceId}_live_`
    const rawCatId = selectedCategoryId?.startsWith(livePrefix)
      ? selectedCategoryId.replace(livePrefix, '')
      : null

    const cacheKey = `${activeSourceId}:${rawCatId || '__all__'}`
    if (loadedCatsRef.current.has(cacheKey)) return

    let cancelled = false
    const load = async () => {
      setLoadError(null)
      setPlaylistLoading(true)

      try {
        if (rawCatId) {
          const streams = await xtreamApi.getLiveStreams(creds, rawCatId)
          if (cancelled) return
          addChannels(xtreamApi.liveStreamsToChannels(streams, creds, activeSourceId))
        } else {
          const hasAnyLive = channels.some((c) => c.type === 'live' && c.sourceId === activeSourceId)
          if (hasAnyLive) {
            loadedCatsRef.current.add(cacheKey)
            return
          }

          const streams = await xtreamApi.getLivePreviewStreams(creds, 500)
          if (cancelled) return
          addChannels(xtreamApi.liveStreamsToChannels(streams, creds, activeSourceId))
        }

        loadedCatsRef.current.add(cacheKey)
      } catch (err) {
        if (cancelled) return
        console.error('Failed to load live streams:', err)
        setLoadError(err instanceof Error ? err.message : 'Kanallar yuklenemedi')
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

  const handlePlay = useCallback(
    (channel: Channel) => {
      if (!isPlayableChannel(channel)) return
      playChannel(channel)
      setMiniPlayer(false)
      navigate('/player')
    },
    [playChannel, setMiniPlayer, navigate]
  )

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
          <ChannelGrid channels={filtered} onPlay={handlePlay} />
        )}
      </div>
    </div>
  )
}
