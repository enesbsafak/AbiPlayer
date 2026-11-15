import { Component, type ReactNode, type ErrorInfo } from 'react'
import { RotateCcw } from 'lucide-react'
import { toUserMessage } from '@/services/user-error'
import { strings } from '@/strings'
import { ERROR_ACTION_CLASS, ErrorScreen } from './ErrorScreen'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('ErrorBoundary caught:', error, info.componentStack)
  }

  handleReload = (): void => {
    this.setState({ hasError: false, error: null })
  }

  override render(): ReactNode {
    if (!this.state.hasError) return this.props.children

    return (
      <ErrorScreen
        fullScreen
        title={strings.shell.errors.unexpectedTitle}
        message={toUserMessage(this.state.error, strings.shell.errors.appStopped)}
        detail={this.state.error?.message || undefined}
        actions={
          <button type="button" onClick={this.handleReload} className={ERROR_ACTION_CLASS}>
            <RotateCcw size={16} aria-hidden="true" />
            {strings.common.retry}
          </button>
        }
      />
    )
  }
}
