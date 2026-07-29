import { isRouteErrorResponse, useNavigate, useRouteError } from 'react-router-dom'
import { AlertCircle, Home } from 'lucide-react'

function describeRouteError(error: unknown): string {
  if (isRouteErrorResponse(error)) {
    return `${error.status} ${error.statusText}`
  }
  if (error instanceof Error) {
    return error.message || 'Bilinmeyen hata'
  }
  return 'Bilinmeyen hata'
}

/**
 * React Router catches render/loader failures itself and never lets them reach
 * the ErrorBoundary that wraps RouterProvider — without this the user would
 * land on the router's untranslated default screen with no way back.
 */
export function RouteError() {
  const error = useRouteError()
  const navigate = useNavigate()

  console.error('RouteError caught:', error)

  return (
    <div className="flex h-screen items-center justify-center bg-surface-950 text-surface-50">
      <div className="flex max-w-md flex-col items-center gap-4 rounded-lg border border-red-500/25 bg-red-500/10 p-8 text-center">
        <AlertCircle size={48} className="text-red-400" />
        <h2 className="text-lg font-semibold">Sayfa yuklenemedi</h2>
        <p className="text-sm text-surface-400">{describeRouteError(error)}</p>
        <button
          type="button"
          onClick={() => navigate('/', { replace: true })}
          className="mt-2 flex items-center gap-2 rounded-lg bg-accent/20 px-4 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/30"
        >
          <Home size={16} />
          Ana Sayfaya Don
        </button>
      </div>
    </div>
  )
}
