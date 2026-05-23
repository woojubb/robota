import React from 'react';
import ReactDOM from 'react-dom/client';

import { SessionMonitor } from '../src/components/SessionMonitor.js';
import './main.css';

// WS URL is injected by the HTTP server via <meta name="ws-url">.
// Fallback: same host (works when WS and HTTP share a port).
const wsUrl =
  document.querySelector('meta[name="ws-url"]')?.getAttribute('content') ??
  `ws://${window.location.host}`;

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('No #root element');

interface IErrorBoundaryState {
  error: Error | null;
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, IErrorBoundaryState> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): IErrorBoundaryState {
    return { error };
  }

  override render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-[var(--background)] flex items-center justify-center p-8">
          <div className="text-[var(--destructive)] font-mono text-[13px] max-w-[600px]">
            <p className="text-[var(--foreground)] mb-2 font-bold">Monitor Error</p>
            <p className="text-[var(--muted-foreground)] mb-2">{this.state.error.message}</p>
            <pre className="bg-[var(--card)] p-3 rounded-md text-[var(--muted-foreground)] text-[11px] overflow-auto whitespace-pre-wrap">
              {this.state.error.stack}
            </pre>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <ErrorBoundary>
      <div className="h-screen w-screen overflow-hidden">
        <SessionMonitor wsUrl={wsUrl} />
      </div>
    </ErrorBoundary>
  </React.StrictMode>,
);
