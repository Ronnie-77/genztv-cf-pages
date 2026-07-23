'use client'

import React from 'react'
import { AlertCircle, RefreshCw, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ErrorBoundaryProps {
  children: React.ReactNode
  fallback?: React.ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo)

    // For chunk loading errors, automatically reload the page after a short delay
    // This happens when the dev server restarts and chunk hashes change
    const isChunkError = error?.message?.includes('Failed to load chunk') ||
      error?.name === 'ChunkLoadError'

    if (isChunkError) {
      // Auto-reload after 2 seconds to give the server time to compile
      setTimeout(() => {
        window.location.reload()
      }, 2000)
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null })
  }

  handleReload = () => {
    // Full page reload preserves the hash, so the same page will be loaded
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      const isChunkError = this.state.error?.message?.includes('Failed to load chunk') ||
        this.state.error?.name === 'ChunkLoadError'

      return (
        <div className="flex flex-col items-center justify-center min-h-[40vh] p-6 text-center">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
            <AlertCircle className="h-8 w-8 text-destructive" />
          </div>
          <h3 className="text-lg font-semibold mb-2">Something went wrong</h3>
          <p className="text-sm text-muted-foreground max-w-md mb-4">
            {isChunkError
              ? 'The page is being compiled. Reloading automatically...'
              : this.state.error?.message || 'An unexpected error occurred while loading this page.'}
          </p>
          <div className="flex gap-3">
            <Button onClick={this.handleRetry} variant="outline" className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Try Again
            </Button>
            <Button onClick={this.handleReload} className="gap-2">
              <RotateCw className="h-4 w-4" />
              Reload Page
            </Button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
