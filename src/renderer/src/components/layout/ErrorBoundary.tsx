import { Component, type ReactNode, type ErrorInfo } from 'react'
import { RotateCcw } from 'lucide-react'
import { toUserMessage } from '@/services/user-error'
import { ERROR_ACTION_CLASS, ErrorScreen } from './ErrorScreen'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('ErrorBoundary caught:', error, info.componentStack)
  }

  handleReload = (): void => {
    this.setState({ hasError: false, error: null })
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children

    return (
      <ErrorScreen
        fullScreen
        title="Beklenmeyen bir hata oluştu"
        message={toUserMessage(this.state.error, 'Uygulama beklenmedik şekilde durdu.')}
        detail={this.state.error?.message || undefined}
        actions={
          <button type="button" onClick={this.handleReload} className={ERROR_ACTION_CLASS}>
            <RotateCcw size={16} aria-hidden="true" />
            Tekrar Dene
          </button>
        }
      />
    )
  }
}
