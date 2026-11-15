import { useCallback, useEffect, useState } from 'react'
import {
  checkForAppUpdates,
  getAppUpdateState,
  installAppUpdate,
  isElectron,
  onAppUpdateStateChange,
  type AppUpdateState
} from '@/services/platform'
import { toUserMessage } from '@/services/user-error'

/**
 * Shared view of the updater. The main process is the single source of truth and
 * broadcasts every transition, so several components can hold their own
 * subscription without disagreeing; `isChecking` / `isInstalling` only cover the
 * gap before the first broadcast lands.
 */
export function useAppUpdate() {
  const [state, setState] = useState<AppUpdateState | null>(null)
  const [isChecking, setIsChecking] = useState(false)
  const [isInstalling, setIsInstalling] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)

  useEffect(() => {
    if (!isElectron()) return

    let mounted = true
    getAppUpdateState()
      .then((nextState) => {
        if (!mounted || !nextState) return
        setState(nextState)
      })
      .catch((error: unknown) => {
        // The first broadcast still arrives; only the initial snapshot is lost.
        console.warn('[updater] initial state unavailable:', error)
      })

    const unsubscribe = onAppUpdateStateChange((nextState) => {
      if (!mounted) return
      setState(nextState)
      if (nextState.status !== 'checking') {
        setIsChecking(false)
      }
    })

    return () => {
      mounted = false
      unsubscribe?.()
    }
  }, [])

  // Resolves to the state the check produced, or null if it could not run. A
  // rejected IPC call used to leave `isChecking` stuck at true, so the badge
  // and the settings button stayed on "Kontrol ediliyor" until a restart.
  const check = useCallback(async (): Promise<AppUpdateState | null> => {
    setIsChecking(true)
    setCheckError(null)
    let stillChecking = false
    try {
      const nextState = await checkForAppUpdates()
      if (nextState) setState(nextState)
      // A broadcast clears the flag when the check finishes in the background.
      stillChecking = nextState?.status === 'checking'
      return nextState
    } catch (error) {
      setCheckError(toUserMessage(error, 'Güncelleme denetlenemedi.'))
      return null
    } finally {
      if (!stillChecking) setIsChecking(false)
    }
  }, [])

  const install = useCallback(async () => {
    setIsInstalling(true)
    let started = false
    try {
      started = await installAppUpdate()
    } catch (error) {
      setCheckError(toUserMessage(error, 'Güncelleme kurulamadı.'))
    } finally {
      if (!started) setIsInstalling(false)
    }
  }, [])

  return { state, isChecking, isInstalling, checkError, check, install }
}
