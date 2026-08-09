import { useCallback, useEffect, useState } from 'react'
import {
  checkForAppUpdates,
  getAppUpdateState,
  installAppUpdate,
  isElectron,
  onAppUpdateStateChange,
  type AppUpdateState
} from '@/services/platform'

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

  useEffect(() => {
    if (!isElectron()) return

    let mounted = true
    void getAppUpdateState().then((nextState) => {
      if (!mounted || !nextState) return
      setState(nextState)
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

  const check = useCallback(async () => {
    setIsChecking(true)
    const nextState = await checkForAppUpdates()
    if (nextState) setState(nextState)
    if (!nextState || nextState.status !== 'checking') {
      setIsChecking(false)
    }
  }, [])

  const install = useCallback(async () => {
    setIsInstalling(true)
    const started = await installAppUpdate()
    if (!started) setIsInstalling(false)
  }, [])

  return { state, isChecking, isInstalling, check, install }
}
