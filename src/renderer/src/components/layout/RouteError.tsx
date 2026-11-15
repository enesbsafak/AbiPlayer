import { useEffect } from 'react'
import { isRouteErrorResponse, useLocation, useNavigate, useRouteError } from 'react-router-dom'
import { Home, RotateCcw, Settings } from 'lucide-react'
import { toUserMessage } from '@/services/user-error'
import { ERROR_ACTION_CLASS, ERROR_SECONDARY_ACTION_CLASS, ErrorScreen } from './ErrorScreen'

function describeRouteError(error: unknown): { message: string; detail?: string } {
  if (isRouteErrorResponse(error)) {
    return {
      message: error.status === 404 ? 'Aradığınız sayfa bulunamadı.' : 'Sayfa açılamadı.',
      detail: `${error.status} ${error.statusText}`
    }
  }
  const detail = error instanceof Error ? error.message : undefined
  return { message: toUserMessage(error, 'Beklenmeyen bir hata oluştu.'), detail }
}

interface RouteErrorProps {
  /** Set on the root route, where the failure took the whole shell with it. */
  fullScreen?: boolean
}

/**
 * React Router catches render/loader failures itself and never lets them reach
 * the ErrorBoundary that wraps RouterProvider — without this the user would
 * land on the router's untranslated default screen with no way back.
 *
 * Child routes get the inline variant, so a page that throws leaves the title
 * bar, sidebar and window controls in place.
 */
export function RouteError({ fullScreen = false }: RouteErrorProps) {
  const error = useRouteError()
  const navigate = useNavigate()
  const location = useLocation()
  const { message, detail } = describeRouteError(error)
  const onHome = location.pathname === '/'

  useEffect(() => {
    console.error('RouteError caught:', error)
  }, [error])

  return (
    <ErrorScreen
      fullScreen={fullScreen}
      title="Sayfa yüklenemedi"
      message={message}
      detail={detail}
      actions={
        <>
          {/* Re-entering the same location remounts the route once; nothing
              here navigates on its own, so a page that keeps throwing cannot
              bounce between itself and this screen. */}
          <button
            type="button"
            onClick={() =>
              navigate(
                { pathname: location.pathname, search: location.search, hash: location.hash },
                { replace: true, state: location.state }
              )
            }
            className={ERROR_ACTION_CLASS}
          >
            <RotateCcw size={16} aria-hidden="true" />
            Tekrar Dene
          </button>
          {onHome ? (
            // "Ana Sayfaya Dön" from a broken home page leads straight back
            // here; settings is where a bad source can be removed.
            <button
              type="button"
              onClick={() => navigate('/settings', { replace: true })}
              className={ERROR_SECONDARY_ACTION_CLASS}
            >
              <Settings size={16} aria-hidden="true" />
              Ayarlara Git
            </button>
          ) : (
            <button
              type="button"
              onClick={() => navigate('/', { replace: true })}
              className={ERROR_SECONDARY_ACTION_CLASS}
            >
              <Home size={16} aria-hidden="true" />
              Ana Sayfaya Dön
            </button>
          )}
        </>
      }
    />
  )
}
