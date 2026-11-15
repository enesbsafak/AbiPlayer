import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { KeyRound, X } from 'lucide-react'
import { useStore } from '@/store'
import { ACTION } from '@/components/settings/controls'
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
    // Below the top bar (two rows below 1280 px on inner screens), over the page.
    <div className="pointer-events-none fixed inset-x-0 top-[140px] z-50 xl:top-[88px] flex flex-col items-center gap-2 px-4">
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
      className="pointer-events-auto flex w-full max-w-2xl items-start gap-4 rounded-card bg-surface-800 p-5 text-[15px]"
    >
      <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-sun text-ink">
        <KeyRound size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-base font-bold text-white">{title}</p>
        <p className="mt-1 text-surface-300">{message}</p>
        {action && (
          <button type="button" className={`${ACTION.secondary} mt-4`} onClick={action.onClick}>
            {action.label}
          </button>
        )}
      </div>
      <button type="button" className={ACTION.icon} onClick={onDismiss} aria-label={strings.common.dismissNotice}>
        <X size={18} aria-hidden="true" />
      </button>
    </div>
  )
}
