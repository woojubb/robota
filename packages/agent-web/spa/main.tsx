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
        <div
          style={{
            minHeight: '100vh',
            background: '#1e1e2e',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '2rem',
          }}
        >
          <div
            style={{
              color: '#fb7185',
              fontFamily: 'monospace',
              fontSize: '13px',
              maxWidth: '600px',
            }}
          >
            <p style={{ color: '#e4e4ef', marginBottom: '8px', fontWeight: 'bold' }}>
              Monitor Error
            </p>
            <p style={{ color: '#8b8ba3', marginBottom: '8px' }}>{this.state.error.message}</p>
            <pre
              style={{
                background: '#262637',
                padding: '12px',
                borderRadius: '6px',
                color: '#8b8ba3',
                fontSize: '11px',
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
              }}
            >
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
