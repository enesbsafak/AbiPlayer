import { FavoritesView } from '@/components/favorites/FavoritesView'
import { useOpenCatalogItem } from '@/hooks/useOpenCatalogItem'

export default function FavoritesPage() {
  const handlePlay = useOpenCatalogItem()

  return (
    <div className="h-full p-3">
      <div className="rounded-lg border border-surface-800 bg-surface-900 h-full overflow-y-auto p-5">
        <h1 className="text-lg font-semibold text-white">Favoriler</h1>
        <div className="mt-5">
          <FavoritesView onPlay={handlePlay} />
        </div>
      </div>
    </div>
  )
}
