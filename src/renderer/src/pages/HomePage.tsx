import { useCallback, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Tv, Film, Clapperboard, Star } from 'lucide-react'
import { useStore } from '@/store'
import { HomeHero } from '@/components/home/HomeHero'
import { HomeSection } from '@/components/home/HomeSection'
import { HomeError, HomeLoading, HomeWelcome } from '@/components/home/HomeStates'
import { useHomeBootstrap } from '@/hooks/useHomeBootstrap'
import { useCatalogView } from '@/hooks/useCatalogView'
import type { Channel } from '@/types/playlist'
import { isPlayableChannel } from '@/services/playback'
import { applyCatalogView } from '@/services/catalog-view'
import { openPlayerFromRoute } from '@/services/player-navigation'

const MAX_LIVE = 12
const MAX_OTHER = 6

export default function HomePage() {
  const location = useLocation()
  const navigate = useNavigate()
  const channels = useStore((s) => s.channels)
  const sources = useStore((s) => s.sources)
  const favoriteIds = useStore((s) => s.favoriteIds)
  const isLoading = useStore((s) => s.isLoading)
  const isLoadingPlaylist = useStore((s) => s.isLoadingPlaylist)
  const activeSourceId = useStore((s) => s.activeSourceId)
  const playChannel = useStore((s) => s.playChannel)
  const setMiniPlayer = useStore((s) => s.setMiniPlayer)
  const setPlayerReturnTarget = useStore((s) => s.setPlayerReturnTarget)
  const syncProgress = useStore((s) => (activeSourceId ? s.syncProgress[activeSourceId] : undefined))
  const authError = useStore((s) => s.error)

  const bootstrap = useHomeBootstrap()

  const handlePlay = useCallback(
    (channel: Channel) => {
      if (!isPlayableChannel(channel)) {
        if (channel.type === 'series') navigate('/series')
        return
      }

      playChannel(channel)
      setMiniPlayer(false)
      openPlayerFromRoute({ location, navigate, setPlayerReturnTarget })
    },
    [location, playChannel, setMiniPlayer, navigate, setPlayerReturnTarget]
  )

  const catalogView = useCatalogView()

  const { recentLive, recentVod, recentSeries } = useMemo(() => {
    const live: Channel[] = []
    const vod: Channel[] = []
    const series: Channel[] = []

    // The dashboard shows the first few of each type, so it is the screen the
    // catalog order hits hardest — an M3U playlist that opens with its adult
    // groups used to fill every row here.
    for (const channel of applyCatalogView(channels, catalogView)) {
      if (live.length < MAX_LIVE && channel.type === 'live') live.push(channel)
      if (vod.length < MAX_OTHER && channel.type === 'vod') vod.push(channel)
      if (series.length < MAX_OTHER && channel.type === 'series') series.push(channel)

      if (live.length >= MAX_LIVE && vod.length >= MAX_OTHER && series.length >= MAX_OTHER) {
        break
      }
    }

    return { recentLive: live, recentVod: vod, recentSeries: series }
  }, [channels, catalogView])

  // Favourites are an explicit user pick rather than a catalog listing, so
  // category hiding deliberately does not apply to them.
  const favChannels = useMemo(() => {
    const fav: Channel[] = []
    for (const channel of channels) {
      if (fav.length >= MAX_OTHER) break
      if (favoriteIds.has(channel.id)) fav.push(channel)
    }
    return fav
  }, [channels, favoriteIds])

  if (sources.length === 0) return <HomeWelcome />

  const hasNoContent = channels.length === 0
  const showInitialLoading =
    hasNoContent && (isLoading || isLoadingPlaylist || bootstrap.isBootstrapping)

  if (showInitialLoading) {
    return (
      <HomeLoading
        isConnectingSources={isLoading && !isLoadingPlaylist}
        stage={bootstrap.stage}
        onRetry={bootstrap.retry}
      />
    )
  }

  // `bootstrap.error` only covers the catalog fetch; connection failures live in
  // the auth slice and used to be surfaced nowhere, so a wrong password or dead
  // server just showed an empty dashboard.
  const blockingError = bootstrap.error ?? authError
  if (blockingError && hasNoContent) {
    return <HomeError message={blockingError} onRetry={bootstrap.retry} />
  }

  return (
    <div className="flex flex-col gap-8 p-4">
      <HomeHero channelCount={channels.length} syncProgress={syncProgress} />

      <HomeSection
        title="Favoriler"
        icon={Star}
        viewAllTo="/favorites"
        channels={favChannels}
        onPlay={handlePlay}
      />
      <HomeSection
        title="Canlı TV"
        icon={Tv}
        viewAllTo="/live"
        channels={recentLive}
        onPlay={handlePlay}
      />
      <HomeSection
        title="Filmler"
        icon={Film}
        iconClassName="text-signal"
        viewAllTo="/vod"
        channels={recentVod}
        onPlay={handlePlay}
      />
      <HomeSection
        title="Diziler"
        icon={Clapperboard}
        iconClassName="text-signal"
        viewAllTo="/series"
        channels={recentSeries}
        onPlay={handlePlay}
      />
    </div>
  )
}
