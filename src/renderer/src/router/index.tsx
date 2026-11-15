import { lazy, Suspense, type ReactNode } from 'react'
import { createHashRouter, RouterProvider, type RouteObject } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { ErrorBoundary } from '@/components/layout/ErrorBoundary'
import { RouteError } from '@/components/layout/RouteError'
import { Spinner } from '@/components/ui/Spinner'
// Always the first route: part of the main bundle, so the dashboard does not
// wait for a second chunk after the shell is up.
import HomePage from '@/pages/HomePage'

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

function page(element: ReactNode) {
  return <Suspense fallback={<Loading />}>{element}</Suspense>
}

export const appRoutes: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    // Only reached when the shell itself fails; it redraws the window
    // controls so the frameless window can still be closed.
    errorElement: <RouteError fullScreen />,
    children: [
      {
        // Pathless layout route: a page that throws renders its error inside
        // the shell's outlet, leaving title bar and sidebar usable.
        errorElement: <RouteError />,
        children: [
          { index: true, element: <HomePage /> },
          { path: 'live', element: page(<LiveTVPage />) },
          { path: 'vod', element: page(<VODPage />) },
          { path: 'series', element: page(<SeriesPage />) },
          { path: 'epg', element: page(<EPGPage />) },
          { path: 'favorites', element: page(<FavoritesPage />) },
          { path: 'search', element: page(<SearchPage />) },
          { path: 'settings', element: page(<SettingsPage />) },
          { path: 'player', element: page(<PlayerPage />) }
        ]
      }
    ]
  }
]

const router = createHashRouter(appRoutes)

export function AppRouter() {
  return (
    <ErrorBoundary>
      <RouterProvider router={router} />
    </ErrorBoundary>
  )
}
