import { lazy, Suspense } from 'react'
import { createHashRouter, RouterProvider } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { Spinner } from '@/components/ui/Spinner'

const HomePage = lazy(() => import('@/pages/HomePage'))
const LiveTVPage = lazy(() => import('@/pages/LiveTVPage'))
const VODPage = lazy(() => import('@/pages/VODPage'))
const SeriesPage = lazy(() => import('@/pages/SeriesPage'))
const EPGPage = lazy(() => import('@/pages/EPGPage'))
const FavoritesPage = lazy(() => import('@/pages/FavoritesPage'))
const SearchPage = lazy(() => import('@/pages/SearchPage'))
const SettingsPage = lazy(() => import('@/pages/SettingsPage'))
const PlayerPage = lazy(() => import('@/pages/PlayerPage'))

function Loading() {
  return (
    <div className="flex h-full items-center justify-center">
      <Spinner size={32} />
    </div>
  )
}

const router = createHashRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Suspense fallback={<Loading />}><HomePage /></Suspense> },
      { path: 'live', element: <Suspense fallback={<Loading />}><LiveTVPage /></Suspense> },
      { path: 'vod', element: <Suspense fallback={<Loading />}><VODPage /></Suspense> },
      { path: 'series', element: <Suspense fallback={<Loading />}><SeriesPage /></Suspense> },
      { path: 'epg', element: <Suspense fallback={<Loading />}><EPGPage /></Suspense> },
      { path: 'favorites', element: <Suspense fallback={<Loading />}><FavoritesPage /></Suspense> },
      { path: 'search', element: <Suspense fallback={<Loading />}><SearchPage /></Suspense> },
      { path: 'settings', element: <Suspense fallback={<Loading />}><SettingsPage /></Suspense> },
      { path: 'player', element: <Suspense fallback={<Loading />}><PlayerPage /></Suspense> }
    ]
  }
])

export function AppRouter() {
  return <RouterProvider router={router} />
}
