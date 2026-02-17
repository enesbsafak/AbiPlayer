import { useEPG } from '@/hooks/useEPG'
import { EPGGrid } from '@/components/epg/EPGGrid'
import { Spinner } from '@/components/ui/Spinner'
import { Button } from '@/components/ui/Button'
import { RefreshCw } from 'lucide-react'

export default function EPGPage() {
  const { epgLoading, refetchEPG } = useEPG()

  return (
    <div className="flex flex-col h-full p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">TV Guide</h1>
        <Button variant="secondary" size="sm" onClick={refetchEPG} disabled={epgLoading}>
          {epgLoading ? <Spinner size={14} /> : <RefreshCw size={14} />}
          Refresh EPG
        </Button>
      </div>
      <div className="flex-1 min-h-0">
        <EPGGrid />
      </div>
    </div>
  )
}
