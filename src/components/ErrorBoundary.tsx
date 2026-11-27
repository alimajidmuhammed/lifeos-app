import React from 'react';
import { ShieldAlert, RotateCcw } from 'lucide-react';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error.message || 'An unexpected application error occurred.',
    };
  }

  componentDidCatch(error: Error) {
    console.error('LifeinOne ErrorBoundary caught:', error);
    const msg = error?.message || '';
    if (/dynamically imported module|ChunkLoadError|Loading chunk/i.test(msg)) {
      try {
        if (sessionStorage.getItem('lifeos_chunk_reload') !== '1') {
          sessionStorage.setItem('lifeos_chunk_reload', '1');
          window.location.reload();
        }
      } catch {
        // Ignore storage errors
      }
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-dvh flex items-center justify-center bg-[var(--bg-canvas)] p-6">
          <div className="w-full max-w-md rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-6">
            <div className="flex items-center gap-3 text-red-600 dark:text-red-400">
              <ShieldAlert className="h-5 w-5 shrink-0" />
              <h1 className="text-lg font-semibold">Workspace Recovery</h1>
            </div>
            <p className="mt-3 text-sm text-[var(--text-secondary)]">
              LifeinOne encountered an unexpected error. Your offline local cache remains intact.
            </p>
            <pre className="mt-4 max-h-40 overflow-auto rounded-lg bg-[var(--bg-subtle)] p-3 font-numeric text-xs text-[var(--text-muted)]">
              {this.state.message}
            </pre>
            <button
              type="button"
              onClick={() => {
                this.setState({ hasError: false, message: '' });
                window.location.reload();
              }}
              className="mt-5 inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] transition-colors"
            >
              <RotateCcw className="h-4 w-4" />
              Reload Workspace
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
