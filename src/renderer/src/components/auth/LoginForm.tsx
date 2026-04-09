import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Satellite } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Spinner } from '@/components/ui/Spinner'
import { useStore } from '@/store'
import { xtreamApi } from '@/services/xtream-api'
import { secureCredentialService } from '@/services/secure-credentials'
import type { PlaylistSource } from '@/types/playlist'

export function LoginForm() {
  const navigate = useNavigate()
  const [url, setUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const { sources, addSource, setActiveSource, setXtreamAuth } = useStore()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      // Add http:// if no protocol specified (most IPTV servers use HTTP)
      let normalizedUrl = url.trim().replace(/\/+$/, '')
      if (!/^https?:\/\//i.test(normalizedUrl)) {
        normalizedUrl = `http://${normalizedUrl}`
      }

      let parsedUrl: URL
      try {
        parsedUrl = new URL(normalizedUrl)
      } catch {
        throw new Error('Geçersiz sunucu adresi')
      }

      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw new Error('Yalnızca HTTP/HTTPS sunucu adresleri destekleniyor')
      }
      normalizedUrl = parsedUrl.toString().replace(/\/+$/, '')

      // Check for duplicate Xtream source (same URL + username)
      const existing = sources.find(
        (s) => s.type === 'xtream' && s.url === normalizedUrl && s.username === username
      )
      if (existing) {
        throw new Error(`Bu sunucu ve kullanıcı adı zaten "${existing.name}" olarak ekli`)
      }

      const creds = { url: normalizedUrl, username, password }
      const auth = await xtreamApi.authenticate(creds)

      if (auth.user_info.auth !== 1) {
        throw new Error('Kimlik doğrulama başarısız oldu')
      }

      const hostname = parsedUrl.host

      const source: PlaylistSource = {
        id: `xtream_${Date.now()}`,
        name: name || `${username}@${hostname}`,
        type: 'xtream',
        url: creds.url,
        username,
        password,
        addedAt: Date.now()
      }

      await secureCredentialService.set(source.id, creds)
      // Set auth BEFORE addSource to prevent useAutoConnect from triggering a duplicate auth request
      setXtreamAuth(source.id, auth)
      addSource(source)
      setActiveSource(source.id)

      // Clear form
      setUrl('')
      setUsername('')
      setPassword('')
      setName('')

      // Navigate to home to see channels
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bağlantı başarısız oldu')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex items-center gap-3 mb-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10">
          <Satellite className="text-accent" size={20} />
        </div>
        <div>
          <h3 className="font-semibold">Xtream Codes</h3>
          <p className="text-xs text-surface-400">Xtream Codes sunucusuna bağlan</p>
        </div>
      </div>

      <Input id="xtream-name" label="Görünen Ad (opsiyonel)" placeholder="Benim Kaynağım" value={name} onChange={(e) => setName(e.target.value)} />
      <Input id="xtream-url" label="Sunucu URL" placeholder="http://example.com:8080" value={url} onChange={(e) => setUrl(e.target.value)} required />
      <Input id="xtream-user" label="Kullanıcı Adı" placeholder="kullanici_adi" value={username} onChange={(e) => setUsername(e.target.value)} required />
      <Input id="xtream-pass" label="Şifre" type="password" placeholder="şifre" value={password} onChange={(e) => setPassword(e.target.value)} required />

      {error && <p className="text-sm text-red-400">{error}</p>}

      <Button type="submit" disabled={loading} className="mt-2">
        {loading ? <><Spinner size={16} /> Bağlanılıyor...</> : 'Bağlan'}
      </Button>
    </form>
  )
}
