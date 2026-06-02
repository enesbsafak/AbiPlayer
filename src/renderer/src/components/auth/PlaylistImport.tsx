import { useReducer } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, Link, Upload } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Spinner } from '@/components/ui/Spinner'
import { useStore } from '@/store'
import { fetchAndParseM3U, parseM3U } from '@/services/m3u-parser'
import { pickAndReadFile } from '@/services/platform'
import type { PlaylistSource } from '@/types/playlist'

interface FormState {
  mode: 'url' | 'file'
  url: string
  name: string
  loading: boolean
  error: string
}

type FormAction =
  | { type: 'setMode'; mode: 'url' | 'file' }
  | { type: 'setUrl'; value: string }
  | { type: 'setName'; value: string }
  | { type: 'importStart' }
  | { type: 'importError'; message: string }
  | { type: 'importDone' }
  | { type: 'clearForm' }

const initialFormState: FormState = { mode: 'url', url: '', name: '', loading: false, error: '' }

function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case 'setMode':
      return { ...state, mode: action.mode }
    case 'setUrl':
      return { ...state, url: action.value }
    case 'setName':
      return { ...state, name: action.value }
    case 'importStart':
      return { ...state, loading: true, error: '' }
    case 'importError':
      return { ...state, error: action.message }
    case 'importDone':
      return { ...state, loading: false }
    case 'clearForm':
      return { ...state, url: '', name: '' }
    default:
      return state
  }
}

export function PlaylistImport() {
  const navigate = useNavigate()
  const [{ mode, url, name, loading, error }, dispatch] = useReducer(formReducer, initialFormState)

  const { sources, addSource, setActiveSource, addChannels, addCategories } = useStore()

  const handleUrlImport = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!url.trim()) return
    dispatch({ type: 'importStart' })

    try {
      // Add http:// if no protocol specified (consistent with Xtream login)
      let normalizedUrl = url.trim()
      if (!/^https?:\/\//i.test(normalizedUrl)) {
        normalizedUrl = `http://${normalizedUrl}`
      }

      let parsedUrl: URL
      try {
        parsedUrl = new URL(normalizedUrl)
      } catch {
        throw new Error('Geçersiz URL adresi')
      }

      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw new Error('Yalnızca HTTP/HTTPS oynatma listesi adresleri destekleniyor')
      }
      normalizedUrl = parsedUrl.toString()

      // Check for duplicate M3U URL source
      const existing = sources.find(
        (s) => s.type === 'm3u_url' && s.url === normalizedUrl
      )
      if (existing) {
        throw new Error(`Bu URL zaten "${existing.name}" olarak ekli`)
      }

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
      dispatch({ type: 'clearForm' })
      navigate('/')
    } catch (err) {
      dispatch({ type: 'importError', message: err instanceof Error ? err.message : 'İçe aktarma başarısız oldu' })
    } finally {
      dispatch({ type: 'importDone' })
    }
  }

  const handleFileImport = async () => {
    dispatch({ type: 'importStart' })

    try {
      const result = await pickAndReadFile([
        { name: 'Oynatma Listesi Dosyaları', extensions: ['m3u', 'm3u8', 'txt'] }
      ])
      if (!result) { dispatch({ type: 'importDone' }); return }

      // Check for duplicate M3U file source
      const existingFile = sources.find(
        (s) => s.type === 'm3u_file' && s.filePath === result.path
      )
      if (existingFile) {
        throw new Error(`Bu dosya zaten "${existingFile.name}" olarak ekli`)
      }

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
      dispatch({ type: 'clearForm' })
      navigate('/')
    } catch (err) {
      dispatch({ type: 'importError', message: err instanceof Error ? err.message : 'İçe aktarma başarısız oldu' })
    } finally {
      dispatch({ type: 'importDone' })
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 mb-2">
        <div className="flex size-10 items-center justify-center rounded-lg bg-emerald-500/10">
          <FileText className="text-emerald-400" size={20} />
        </div>
        <div>
          <h3 className="font-semibold">M3U Oynatma Listesi</h3>
          <p className="text-xs text-surface-400">URL veya yerel dosyadan içe aktar</p>
        </div>
      </div>

      <div className="flex gap-2">
        <Button variant={mode === 'url' ? 'primary' : 'secondary'} size="sm" onClick={() => dispatch({ type: 'setMode', mode: 'url' })}>
          <Link size={14} /> URL
        </Button>
        <Button variant={mode === 'file' ? 'primary' : 'secondary'} size="sm" onClick={() => dispatch({ type: 'setMode', mode: 'file' })}>
          <Upload size={14} /> Dosya
        </Button>
      </div>

      <Input id="m3u-name" label="Görünen Ad (opsiyonel)" placeholder="Benim Liste" value={name} onChange={(e) => dispatch({ type: 'setName', value: e.target.value })} />

      {mode === 'url' ? (
        <form onSubmit={handleUrlImport} className="flex flex-col gap-4">
          <Input id="m3u-url" label="Liste URL" placeholder="https://example.com/playlist.m3u" value={url} onChange={(e) => dispatch({ type: 'setUrl', value: e.target.value })} required />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <Button type="submit" disabled={loading}>
            {loading ? <><Spinner size={16} /> İçe aktarılıyor…</> : 'Listeyi İçe Aktar'}
          </Button>
        </form>
      ) : (
        <div className="flex flex-col gap-4">
          {error && <p className="text-sm text-red-400">{error}</p>}
          <Button onClick={handleFileImport} disabled={loading}>
            {loading ? <><Spinner size={16} /> Okunuyor…</> : <><Upload size={16} /> Dosya Seç</>}
          </Button>
        </div>
      )}
    </div>
  )
}
