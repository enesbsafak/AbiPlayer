import { FavoritesView } from '@/components/favorites/FavoritesView'
import { useOpenFavorite } from '@/components/favorites/favorite-channels'
import { HomeNotice } from '@/components/home/HomeStates'
import { useDeferredPlayback } from '@/hooks/useDeferredPlayback'
import { useOpenCatalogItem } from '@/hooks/useOpenCatalogItem'
import { strings } from '@/strings'

export default function FavoritesPage() {
  const handlePlay = useOpenCatalogItem()
  const deferred = useDeferredPlayback()
  const handleFavorite = useOpenFavorite(handlePlay, deferred.playWhenReady)

  return (
    <div className="h-full p-3">
      <div className="rounded-lg border border-surface-800 bg-surface-900 h-full overflow-y-auto p-5">
        <h1 className="text-lg font-semibold text-white">{strings.catalog.favorites.title}</h1>
        {deferred.notice && (
          <div className="mt-4">
            <HomeNotice
              message={deferred.notice.message}
              tone={deferred.notice.pending ? 'info' : 'error'}
              onDismiss={deferred.dismissNotice}
            />
          </div>
        )}
        <div className="mt-5">
          <FavoritesView onPlay={handleFavorite} />
        </div>
      </div>
    </div>
  )
}
