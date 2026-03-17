import { Component, type ReactNode, type ErrorInfo } from 'react'
import { AlertCircle, RotateCcw } from 'lucide-react'

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
      <div className="flex h-full items-center justify-center bg-surface-950 text-surface-50">
        <div className="flex max-w-md flex-col items-center gap-4 rounded-2xl border border-red-500/25 bg-red-500/10 p-8 text-center">
          <AlertCircle size={48} className="text-red-400" />
          <h2 className="text-lg font-semibold">Beklenmeyen bir hata olustu</h2>
          <p className="text-sm text-surface-400">
            {this.state.error?.message || 'Bilinmeyen hata'}
          </p>
          <button
            onClick={this.handleReload}
            className="mt-2 flex items-center gap-2 rounded-lg bg-accent/20 px-4 py-2 text-sm font-medium text-accent hover:bg-accent/30 transition-colors"
          >
            <RotateCcw size={16} />
            Tekrar Dene
          </button>
        </div>
      </div>
    )
  }
}
