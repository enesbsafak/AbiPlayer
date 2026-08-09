import { LoginForm } from '@/components/auth/LoginForm'
import { PlaylistImport } from '@/components/auth/PlaylistImport'
import { SourceManager } from '@/components/auth/SourceManager'

export function SourcesSettings() {
  return (
    <div className="flex flex-col gap-6">
      <SourceManager />
      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-lg border border-surface-800 bg-surface-900 p-5">
          <LoginForm />
        </div>
        <div className="rounded-lg border border-surface-800 bg-surface-900 p-5">
          <PlaylistImport />
        </div>
      </div>
    </div>
  )
}
