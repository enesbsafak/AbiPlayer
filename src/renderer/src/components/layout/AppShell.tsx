import { Outlet } from 'react-router-dom'
import { TitleBar } from './TitleBar'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { MiniPlayer } from '@/components/player/MiniPlayer'
import { Spinner } from '@/components/ui/Spinner'
import { useStore } from '@/store'
import { useKeyboard } from '@/hooks/useKeyboard'
import { useEPG } from '@/hooks/useEPG'
import { useAutoConnect } from '@/hooks/useAutoConnect'

export function AppShell() {
  const currentChannel = useStore((s) => s.currentChannel)
  const isMiniPlayer = useStore((s) => s.isMiniPlayer)
  const isLoading = useStore((s) => s.isLoading)
  const sources = useStore((s) => s.sources)

  useAutoConnect()
  useKeyboard()
  useEPG()

  return (
    <div className="flex h-screen flex-col bg-surface-950 text-white">
      <TitleBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <Header />
          <main className="flex-1 overflow-y-auto">
            {isLoading && sources.length > 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3">
                <Spinner size={32} />
                <p className="text-sm text-surface-400">Connecting to your sources...</p>
              </div>
            ) : (
              <Outlet />
            )}
          </main>
        </div>
      </div>
      {currentChannel && isMiniPlayer && <MiniPlayer />}
    </div>
  )
}
