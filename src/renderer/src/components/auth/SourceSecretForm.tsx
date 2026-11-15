import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Spinner } from '@/components/ui/Spinner'
import { useStore } from '@/store'
import { toUserMessage } from '@/services/user-error'
import type { PlaylistSource } from '@/types/playlist'
import { normalizeSecretInput, saveSourceSecret } from './source-secret'

/**
 * Enters the secret of an existing source again, in place: the source keeps
 * its id, so favourites, history and hidden categories stay with it.
 */
export function SourceSecretForm({ source, onDone }: { source: PlaylistSource; onDone: () => void }) {
  const isXtream = source.type === 'xtream'
  const [url, setUrl] = useState(source.url ?? '')
  const [username, setUsername] = useState(source.username ?? '')
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    const input = normalizeSecretInput(source, { url, username, password }, useStore.getState().sources)
    if (!input.ok) {
      setError(input.error)
      return
    }
    setSaving(true)
    setError(null)
    try {
      await saveSourceSecret(source.id, input.secret)
      onDone()
    } catch (cause) {
      setError(`Bilgiler güvenli depoya kaydedilemedi: ${toUserMessage(cause)}`)
    } finally {
      setSaving(false)
    }
  }

  const idPrefix = `secret-${source.id}`
  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className="mt-2 flex flex-col gap-3 rounded-lg border border-surface-800 bg-surface-950 p-3"
      aria-label={`${source.name} bilgilerini yeniden gir`}
    >
      <p className="text-xs text-surface-400">
        Kaynak silinmeden bilgileri yenilenir; favorileriniz, izleme geçmişiniz ve gizlediğiniz kategoriler korunur.
      </p>
      <Input
        id={`${idPrefix}-url`}
        label={isXtream ? 'Sunucu URL' : 'Liste URL'}
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        required
      />
      {isXtream && (
        <>
          <Input
            id={`${idPrefix}-user`}
            label="Kullanıcı Adı"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
          />
          <Input
            id={`${idPrefix}-pass`}
            label="Şifre"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </>
      )}
      {error && (
        <p className="text-xs text-red-400" role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? <><Spinner size={14} /> Kaydediliyor…</> : 'Kaydet ve Bağlan'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone} disabled={saving}>
          Vazgeç
        </Button>
      </div>
    </form>
  )
}
