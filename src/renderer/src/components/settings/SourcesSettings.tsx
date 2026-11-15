import { useState } from 'react'
import { useStore } from '@/store'
import { AddSource } from '@/components/auth/AddSource'
import { SourceManager } from '@/components/auth/SourceManager'
import { TrustedCertificates } from '@/components/security/TrustedCertificates'

/**
 * The sources the user has (with the one in use filled), the servers they
 * trusted, and the guided step that adds one. With no source yet the step
 * is the whole tab: it is where a new user starts.
 */
export function SourcesSettings() {
  const hasSources = useStore((s) => s.sources.length > 0)
  // While a source's sign-in is being entered again, its form holds the
  // screen's one primary action and the add step's button steps back.
  const [editing, setEditing] = useState(false)

  return (
    <div className="flex flex-col gap-8">
      <SourceManager onEditingChange={setEditing} />
      <TrustedCertificates />
      <AddSource first={!hasSources} subdued={editing} />
    </div>
  )
}
