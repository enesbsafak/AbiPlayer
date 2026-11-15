import { FavoritesView } from '@/components/favorites/FavoritesView'
import { useOpenFavorite } from '@/components/favorites/favorite-channels'
import { HomeNotice } from '@/components/home/HomeStates'
import { useDeferredPlayback } from '@/hooks/useDeferredPlayback'
import { useOpenCatalogItem } from '@/hooks/useOpenCatalogItem'

/** Favoriler: the title is in the top bar; the favourites sit on the ground, grouped and headed. */
export default function FavoritesPage() {
  const handlePlay = useOpenCatalogItem()
  const deferred = useDeferredPlayback()
  const handleFavorite = useOpenFavorite(handlePlay, deferred.playWhenReady)

  return (
    <div className="flex h-full flex-col gap-4 p-3">
      {deferred.notice && (
        <HomeNotice
          message={deferred.notice.message}
          tone={deferred.notice.pending ? 'info' : 'error'}
          onDismiss={deferred.dismissNotice}
        />
      )}
      <div className="min-h-0 flex-1">
        <FavoritesView onPlay={handleFavorite} />
      </div>
    </div>
  )
}
