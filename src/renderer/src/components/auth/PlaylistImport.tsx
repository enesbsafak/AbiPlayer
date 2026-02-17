import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, Link, Upload } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Spinner } from '@/components/ui/Spinner'
import { useStore } from '@/store'
import { fetchAndParseM3U, parseM3U } from '@/services/m3u-parser'
import { pickAndReadFile } from '@/services/platform'
import type { PlaylistSource } from '@/types/playlist'

export function PlaylistImport() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<'url' | 'file'>('url')
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const { addSource, setActiveSource, addChannels, addCategories } = useStore()

  const handleUrlImport = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!url.trim()) return
    setError('')
    setLoading(true)

    try {
      const parsedUrl = new URL(url.trim())
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw new Error('Yalnizca HTTP/HTTPS oynatma listesi adresleri destekleniyor')
      }
      const normalizedUrl = parsedUrl.toString()

      const source: PlaylistSource = {
        id: `m3u_${Date.now()}`,
        name: name || parsedUrl.hostname,
        type: 'm3u_url',
        url: normalizedUrl,
        addedAt: Date.now()
      }

      const { channels, categories } = await fetchAndParseM3U(normalizedUrl, source.id)
      addSource(source)
      addChannels(channels)
      addCategories(categories)
      setActiveSource(source.id)
      setUrl('')
      setName('')
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ice aktarma basarisiz oldu')
    } finally {
      setLoading(false)
    }
  }

  const handleFileImport = async () => {
    setError('')
    setLoading(true)

    try {
      const result = await pickAndReadFile([
        { name: 'Oynatma Listesi Dosyalari', extensions: ['m3u', 'm3u8', 'txt'] }
      ])
      if (!result) { setLoading(false); return }
      const fileName = result.path.split(/[\\/]/).pop() || 'Yerel Liste'

      const source: PlaylistSource = {
        id: `m3u_file_${Date.now()}`,
        name: name || fileName,
        type: 'm3u_file',
        filePath: result.path,
        addedAt: Date.now()
      }

      const { channels, categories } = parseM3U(result.content, source.id)
      addSource(source)
      addChannels(channels)
      addCategories(categories)
      setActiveSource(source.id)
      setName('')
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ice aktarma basarisiz oldu')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 mb-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10">
          <FileText className="text-emerald-400" size={20} />
        </div>
        <div>
          <h3 className="font-semibold">M3U Oynatma Listesi</h3>
          <p className="text-xs text-surface-400">URL veya yerel dosyadan ice aktar</p>
        </div>
      </div>

      <div className="flex gap-2">
        <Button variant={mode === 'url' ? 'primary' : 'secondary'} size="sm" onClick={() => setMode('url')}>
          <Link size={14} /> URL
        </Button>
        <Button variant={mode === 'file' ? 'primary' : 'secondary'} size="sm" onClick={() => setMode('file')}>
          <Upload size={14} /> Dosya
        </Button>
      </div>

      <Input id="m3u-name" label="Gorunen Ad (opsiyonel)" placeholder="Benim Liste" value={name} onChange={(e) => setName(e.target.value)} />

      {mode === 'url' ? (
        <form onSubmit={handleUrlImport} className="flex flex-col gap-4">
          <Input id="m3u-url" label="Liste URL" placeholder="https://example.com/playlist.m3u" value={url} onChange={(e) => setUrl(e.target.value)} required />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <Button type="submit" disabled={loading}>
            {loading ? <><Spinner size={16} /> Ice aktariliyor...</> : 'Listeyi Ice Aktar'}
          </Button>
        </form>
      ) : (
        <div className="flex flex-col gap-4">
          {error && <p className="text-sm text-red-400">{error}</p>}
          <Button onClick={handleFileImport} disabled={loading}>
            {loading ? <><Spinner size={16} /> Okunuyor...</> : <><Upload size={16} /> Dosya Sec</>}
          </Button>
        </div>
      )}
    </div>
  )
}
