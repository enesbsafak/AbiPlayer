import { LoginForm } from '@/components/auth/LoginForm'
import { PlaylistImport } from '@/components/auth/PlaylistImport'
import { SourceManager } from '@/components/auth/SourceManager'
import { PendingSourceCapture } from '@/components/security/PendingSourceCapture'
import { TrustedCertificates } from '@/components/security/TrustedCertificates'

export function SourcesSettings() {
  return (
    <div className="flex flex-col gap-6">
      <SourceManager />
      <TrustedCertificates />
      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-lg border border-surface-800 bg-surface-900 p-5">
          <PendingSourceCapture urlFieldId="xtream-url">
            <LoginForm />
          </PendingSourceCapture>
        </div>
        <div className="rounded-lg border border-surface-800 bg-surface-900 p-5">
          <PendingSourceCapture urlFieldId="m3u-url">
            <PlaylistImport />
          </PendingSourceCapture>
        </div>
      </div>
    </div>
  )
}
