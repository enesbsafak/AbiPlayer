import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { KeyRound, X } from 'lucide-react'
import { useStore } from '@/store'
import { Button } from '@/components/ui/Button'
import { secureCredentialService, type SecureCredentialsLossNotice } from '@/services/secure-credentials'
import { strings } from '@/strings'

const text = strings.sources.credentials

export const CREDENTIAL_LOSS_TITLE = text.lossTitle

/** What the loss notice says; the quarantined file name is mentioned when main kept a copy. */
export function credentialLossMessage(notice: SecureCredentialsLossNotice): string {
  return text.lossMessage(notice.quarantinedAs ?? null)
}

export const SECRET_STORE_NOTICE_TITLE = text.storeTitle

/**
 * Shown over the shell when the saved sign-ins are gone (main moved an
 * unreadable credential file aside), cannot be read right now, or could not
 * be moved to the secure store. Dismissible; it is about this run only, main
 * reports a loss once per run.
 */
export function CredentialNotice() {
  const navigate = useNavigate()
  const migrationError = useStore((s) => s.secretMigrationError)
  const setSecretMigrationError = useStore((s) => s.setSecretMigrationError)
  const secretStoreError = useStore((s) => s.secretStoreError)
  const requestSourceReconnect = useStore((s) => s.requestSourceReconnect)
  const [storeErrorDismissed, setStoreErrorDismissed] = useState<string | null>(null)
  const [loss, setLoss] = useState<SecureCredentialsLossNotice | null>(null)
  const [lossDismissed, setLossDismissed] = useState(false)

  useEffect(() => {
    let active = true
    const unsubscribe = secureCredentialService.onLost((notice) => {
      if (active) setLoss(notice)
    })
    secureCredentialService
      .getLossNotice()
      .then((notice) => {
        if (active && notice) setLoss((current) => current ?? notice)
      })
      .catch(() => undefined)
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const showLoss = loss !== null && !lossDismissed
  const showStoreError = secretStoreError !== null && storeErrorDismissed !== secretStoreError
  if (!showLoss && !migrationError && !showStoreError) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 top-12 z-50 flex flex-col items-center gap-2 px-4">
      {showLoss && loss && (
        <NoticeCard
          title={CREDENTIAL_LOSS_TITLE}
          message={credentialLossMessage(loss)}
          onDismiss={() => setLossDismissed(true)}
          action={{ label: text.lossAction, onClick: () => void navigate('/settings') }}
        />
      )}
      {showStoreError && secretStoreError && (
        <NoticeCard
          title={SECRET_STORE_NOTICE_TITLE}
          message={secretStoreError}
          onDismiss={() => setStoreErrorDismissed(secretStoreError)}
          action={{ label: strings.common.retry, onClick: requestSourceReconnect }}
        />
      )}
      {migrationError && (
        <NoticeCard
          title={text.migrationTitle}
          message={migrationError}
          onDismiss={() => setSecretMigrationError(null)}
        />
      )}
    </div>
  )
}

function NoticeCard({
  title,
  message,
  onDismiss,
  action
}: {
  title: string
  message: string
  onDismiss: () => void
  action?: { label: string; onClick: () => void }
}) {
  return (
    <div
      role="alert"
      className="pointer-events-auto flex w-full max-w-2xl items-start gap-3 rounded-lg border border-amber-500/40 bg-surface-900 p-4 text-sm shadow-lg"
    >
      <KeyRound size={18} className="mt-0.5 shrink-0 text-amber-400" aria-hidden="true" />
      <div className="flex-1">
        <p className="font-medium text-white">{title}</p>
        <p className="mt-1 text-surface-300">{message}</p>
        {action && (
          <Button variant="secondary" size="sm" className="mt-3" onClick={action.onClick}>
            {action.label}
          </Button>
        )}
      </div>
      <Button variant="ghost" size="sm" onClick={onDismiss} aria-label={strings.common.dismissNotice}>
        <X size={14} />
      </Button>
    </div>
  )
}
